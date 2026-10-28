"""Capability secrets for the pilot's project links.

A project is reachable only through its capability link,
``/p/<project-id>#key=<secret>``. The browser keeps the secret and sends it in
an ``Authorization: Bearer <secret>`` header on every later project call. The
server stores only the SHA-256 digest of the secret, never the secret.

Why a fast hash is correct here
-------------------------------
The secret is 256 bits of ``secrets.token_urlsafe(32)`` output. It is random,
so it has no guessable structure and no low-entropy space to search: guessing
it is not cheaper than generating a fresh secret. A fast hash is therefore the
right tool, and the pilot needs the check on every project request.

This reasoning does **not** extend to user-chosen passwords. A password is
low-entropy, so anyone who can read the database can test candidates against a
fast hash. Passwords would need a slow, salted key-derivation function
(Argon2id, scrypt, or bcrypt) with a per-user salt and a tunable cost, and the
stored column would hold the derived key rather than a plain digest.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

# 32 random bytes are 256 bits of entropy. `token_urlsafe` renders them as 43
# URL-safe characters, which is short enough to paste and long enough to be
# unguessable.
SECRET_BYTES = 32


def generate_secret() -> str:
    """Return a fresh 256-bit capability secret."""
    return secrets.token_urlsafe(SECRET_BYTES)


def hash_secret(secret: str) -> bytes:
    """Return the digest stored for a capability secret."""
    return hashlib.sha256(secret.encode("utf-8")).digest()


def secret_matches(secret: str, stored_hash: bytes) -> bool:
    """Whether a presented secret is the one behind the stored digest.

    The comparison is constant time so a caller cannot learn the digest one
    byte at a time from the response time.
    """
    return hmac.compare_digest(hash_secret(secret), stored_hash)


def bearer_token(header: str | None) -> str | None:
    """Extract the capability secret from an ``Authorization`` header.

    A missing or malformed header yields no secret, which the caller treats
    exactly like a wrong secret: a 404, never a hint that a project exists.
    """
    if header is None:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    if not token:
        return None
    return token
