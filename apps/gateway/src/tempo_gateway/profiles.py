"""Profile and skill routes (SHIPPING §4.5), behind the same bearer as /missions.

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | Returns |
|---|---|
| GET /skills | every skill manifest |
| GET /profiles | the public profiles, as views |
| GET /profiles/{id} | one view; 404 if unknown |
| GET /profiles/{id}/share | the share code and the web URL that carries it in the fragment |
| POST /profiles/import {"code"} | the view of a pasted code; 413 over 4096 bytes, 422 with why |

Importing never persists anything: the Gateway validates and echoes, and the web keeps the code in
the URL fragment so it never reaches a server log.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from tempo_core.profiles import (
    MAX_SHARE_BYTES,
    Profile,
    ProfileCatalog,
    ProfileInvalid,
    from_share_code,
    share_code,
)


class ImportBody(BaseModel):
    code: str


def _view(catalog: ProfileCatalog, profile: Profile) -> dict[str, Any]:
    return catalog.view(profile).model_dump(mode="json")


def _found(catalog: ProfileCatalog, profile_id: str) -> Profile:
    profile = catalog.get(profile_id)
    if profile is None:
        raise HTTPException(404, "no profile has this id")
    return profile


def profiles_router(catalog: ProfileCatalog, web_caller: Any, *, web_origin: str) -> APIRouter:
    router = APIRouter()
    Caller = Annotated[str, Depends(web_caller)]

    @router.get("/skills")
    async def skills(caller: Caller) -> dict[str, Any]:
        return {"skills": [m.model_dump(mode="json") for m in catalog.skills.values()]}

    @router.get("/profiles")
    async def profiles(caller: Caller) -> dict[str, Any]:
        return {"profiles": [_view(catalog, p) for p in catalog.public()]}

    @router.get("/profiles/{profile_id}")
    async def profile(profile_id: str, caller: Caller) -> dict[str, Any]:
        return _view(catalog, _found(catalog, profile_id))

    @router.get("/profiles/{profile_id}/share")
    async def share(profile_id: str, caller: Caller) -> dict[str, str]:
        code = share_code(_found(catalog, profile_id))
        return {"code": code, "url": f"{web_origin.rstrip('/')}/profiles/import#p={code}"}

    @router.post("/profiles/import")
    async def import_profile(body: ImportBody, caller: Caller) -> dict[str, Any]:
        if len(body.code.encode("utf-8", "surrogatepass")) > MAX_SHARE_BYTES:
            raise HTTPException(413, f"a share code is at most {MAX_SHARE_BYTES} bytes")
        try:
            imported = from_share_code(body.code, catalog.skills)
        except ProfileInvalid as exc:
            raise HTTPException(422, str(exc)) from None
        return _view(catalog, imported)

    return router
