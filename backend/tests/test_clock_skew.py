# Tests for the clock-skew tolerance in verify_access_token.
#
# Cognito stamps `iat` with AWS time, so a machine whose clock lags AWS by a few
# seconds used to reject freshly issued tokens. These tests sign real RS256
# tokens with a local key, so no AWS request is ever made.

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import auth


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _use_local_key(monkeypatch, signing_key):
    """Point verification at the local public key instead of the Cognito JWKS."""

    class LocalJWKClient:
        def get_signing_key_from_jwt(self, token):
            class SigningKey:
                key = signing_key.public_key()

            return SigningKey()

    monkeypatch.setattr(auth, "jwk_client", LocalJWKClient())


def _token(signing_key, *, issued_at_offset=0, expires_in=3600):
    """An access token shaped like Cognito's, with a controllable `iat`."""
    now = int(time.time())
    claims = {
        "sub": "clock-skew-test-user",
        "token_use": "access",
        "client_id": auth.COGNITO_CLIENT_ID,
        "iss": auth.COGNITO_ISSUER,
        "iat": now + issued_at_offset,
        "exp": now + expires_in,
    }
    return jwt.encode(
        claims, signing_key, algorithm="RS256", headers={"kid": "local-test-key"}
    )


def _credentials(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _verify(token):
    return auth.verify_access_token(_credentials(token))


def test_token_issued_five_seconds_in_the_future_is_accepted(signing_key):
    """The measured skew on this machine is ~5 s; such a token must verify."""
    token = _token(signing_key, issued_at_offset=5)

    claims = _verify(token)

    assert claims["claims"]["sub"] == "clock-skew-test-user"


def test_token_issued_within_the_leeway_is_accepted(signing_key):
    token = _token(signing_key, issued_at_offset=auth.CLOCK_SKEW_LEEWAY - 1)

    assert _verify(token)["claims"]["token_use"] == "access"


def test_token_issued_ten_minutes_in_the_future_is_rejected(signing_key):
    """Leeway is bounded, so a materially future token is still refused."""
    token = _token(signing_key, issued_at_offset=600)

    with pytest.raises(HTTPException) as raised:
        _verify(token)

    assert raised.value.status_code == 401


def test_expired_token_is_rejected(signing_key):
    token = _token(signing_key, expires_in=-(auth.CLOCK_SKEW_LEEWAY + 60))

    with pytest.raises(HTTPException) as raised:
        _verify(token)

    assert raised.value.status_code == 401
    assert raised.value.detail == "Authentication token has expired"


def test_wrong_token_use_is_rejected(signing_key):
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": "clock-skew-test-user",
            "token_use": "id",
            "client_id": auth.COGNITO_CLIENT_ID,
            "iss": auth.COGNITO_ISSUER,
            "iat": now,
            "exp": now + 3600,
        },
        signing_key,
        algorithm="RS256",
        headers={"kid": "local-test-key"},
    )

    with pytest.raises(HTTPException) as raised:
        _verify(token)

    assert raised.value.status_code == 401
    assert raised.value.detail == "Invalid token type"
