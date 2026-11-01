import hmac

from fastapi import Header, HTTPException, status

from .config import get_settings


def require_internal_service_key(
    internal_service_key: str | None = Header(default=None, alias="x-internal-service-key"),
) -> None:
    expected = get_settings().internal_service_key
    if not expected or not internal_service_key or not hmac.compare_digest(internal_service_key, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Gateway authentication required",
        )
