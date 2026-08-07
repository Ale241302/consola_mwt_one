#!/usr/bin/env python3
"""Apply ContextForge userinfo fallback patch for Pocket-ID minimal access tokens."""

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

OLD_CODE = """        # Resolve user identity from verified claims
        user_email = claims.get("email") or claims.get("preferred_username") or claims.get("sub")
        if not user_email or not isinstance(user_email, str) or "@" not in user_email:
            await self._send_error(detail="OAuth token missing valid email claim")
            return OAuthAuthResult.FAILED"""

NEW_CODE = """        # Resolve user identity from verified claims
        user_email = claims.get("email") or claims.get("preferred_username") or claims.get("sub")
        if not user_email or not isinstance(user_email, str) or "@" not in user_email:
            # Fallback for minimal access tokens (e.g. Pocket-ID): fetch userinfo.
            try:
                from contextlib import contextmanager
                from mcpgateway.services.sso_service import resolve_trusted_provider_by_issuer
                from mcpgateway.services.http_client_service import get_http_client
                from mcpgateway.db import SessionLocal

                @contextmanager
                def _sync_db():
                    db = SessionLocal()
                    try:
                        yield db
                        db.commit()
                    except Exception:
                        db.rollback()
                        raise
                    finally:
                        db.close()

                cm = _sync_db()
                db = await asyncio.to_thread(cm.__enter__)
                try:
                    provider = await asyncio.to_thread(resolve_trusted_provider_by_issuer, claims.get("iss"), db)
                finally:
                    await asyncio.to_thread(lambda *args: cm.__exit__(*args), None, None, None)

                if provider and getattr(provider, "userinfo_url", None):
                    client = await get_http_client()
                    resp = await client.get(
                        provider.userinfo_url,
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=10,
                    )
                    if resp.status_code == 200:
                        userinfo = resp.json()
                        user_email = (
                            userinfo.get("email")
                            or userinfo.get("preferred_username")
                            or userinfo.get("sub")
                        )
                        logger.debug("Resolved user_email via userinfo fallback: %s", user_email)
            except Exception:
                logger.warning("userinfo email fallback failed", exc_info=True)

        if not user_email or not isinstance(user_email, str) or "@" not in user_email:
            await self._send_error(detail="OAuth token missing valid email claim")
            return OAuthAuthResult.FAILED"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if OLD_CODE not in content:
        if "_sync_db()" in content and "Pocket-ID" in content:
            print("Patch v3 already applied.")
            return
        print("Old code snippet not found; cannot apply patch.")
        return

    content = content.replace(OLD_CODE, NEW_CODE, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge userinfo fallback patch v3 applied successfully.")


if __name__ == "__main__":
    main()
