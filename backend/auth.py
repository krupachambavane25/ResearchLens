from dataclasses import dataclass

from fastapi import Header, HTTPException
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from requests import RequestException

from backend.config import get_settings


@dataclass(frozen=True)
class UserIdentity:
    user_id: str
    email: str


def verify_google_id_token(token: str, client_id: str) -> dict:
    return id_token.verify_oauth2_token(token, Request(), client_id)


def get_current_user(authorization: str | None = Header(default=None)) -> UserIdentity:
    settings = get_settings()
    client_id = settings.google_client_id.strip()
    if not client_id:
        if settings.auth_required:
            raise HTTPException(status_code=503, detail="Google sign-in is not configured.")
        return UserIdentity(user_id="local", email="Local account")

    allowed_emails = {
        email.strip().lower()
        for email in settings.allowed_google_emails.split(",")
        if email.strip()
    }
    if not allowed_emails:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured.")
    if not authorization:
        raise HTTPException(status_code=401, detail="Sign in with Google to continue.")
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in with Google to continue.")

    try:
        claims = verify_google_id_token(token, client_id)
    except (ValueError, GoogleAuthError, RequestException) as exc:
        raise HTTPException(status_code=401, detail="Google sign-in expired or is invalid.") from exc

    email = str(claims.get("email", "")).strip().lower()
    user_id = claims.get("sub")
    if (
        claims.get("email_verified") is not True
        or not email
        or not isinstance(user_id, str)
        or not user_id
    ):
        raise HTTPException(status_code=401, detail="Google account verification failed.")
    if email not in allowed_emails:
        raise HTTPException(status_code=403, detail="This Google account is not authorized.")
    return UserIdentity(user_id=user_id, email=email)
