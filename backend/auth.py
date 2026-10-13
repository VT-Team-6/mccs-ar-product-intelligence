from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWKClient
from database import get_connection
import boto3
import os
from dotenv import load_dotenv

load_dotenv()

COGNITO_REGION = os.environ["COGNITO_REGION"]
COGNITO_USER_POOL_ID = os.environ["COGNITO_USER_POOL_ID"]
COGNITO_CLIENT_ID = os.environ["COGNITO_CLIENT_ID"]

COGNITO_ISSUER = (
    f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/"
    f"{COGNITO_USER_POOL_ID}"
)

cognito_client = boto3.client(
    "cognito-idp",
    region_name=COGNITO_REGION,
)

JWKS_URL = f"{COGNITO_ISSUER}/.well-known/jwks.json"

jwk_client = PyJWKClient(JWKS_URL)

def verify_access_token(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
) -> dict:
    token = credentials.credentials
    try:
        signing_key = jwk_client.get_signing_key_from_jwt(token)

        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=COGNITO_ISSUER,
            options={"verify_aud": False},
        )

        if claims.get("token_use") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        if claims.get("client_id") != COGNITO_CLIENT_ID:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token client",
            )

        return {
            "claims": claims,
            "token": token
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired",
        )

    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )


def require_authenticated_user(
    auth: dict = Depends(verify_access_token),
):
    claims = auth["claims"]
    token = auth["token"]

    cognito_sub = claims.get("sub")

    if not cognito_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing user identity",
        )
    with get_connection() as conn:
        user = conn.execute(
            """
            SELECT user_id, cognito_sub, email, is_admin
            FROM users
            WHERE cognito_sub = %s
            """,
            (cognito_sub,),
        ).fetchone()

        # create user in our database if they exist in cognito but not our database yet
        if user is None: 
            cognito_user = cognito_client.get_user(AccessToken=token)
            attributes = {
                attribute["Name"]: attribute["Value"]
                for attribute in cognito_user["UserAttributes"]
            }
            email = attributes.get("email")

            if not email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cognito user does not have an email",
                )
            
            user = conn.execute(
                """
                INSERT INTO users (cognito_sub, email)
                VALUES (%s, %s)
                RETURNING user_id, cognito_sub, email, is_admin                    
                """,
                (cognito_sub, email),
            ).fetchone()
    return user


def require_admin(
    user=Depends(require_authenticated_user),
):
    if not user["is_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    return user