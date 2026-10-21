import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# Load variables from backend/.env
load_dotenv(Path(__file__).resolve().parent / ".env")

# Connect to Virginia Tech ARC LLM
client = OpenAI(
    api_key=os.getenv("ARC_API_KEY"),
    base_url=os.getenv("ARC_API_BASE"),
    timeout=60.0,
    max_retries=1,
)

MODEL = os.getenv("ARC_MODEL", "gpt-oss-120b")


def analyze_with_arc(prompt: str) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": "You are a helpful product review analyst."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        max_tokens=1000,
    )

    return response.choices[0].message.content or ""