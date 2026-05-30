from psycopg.types.json import Jsonb

from src.domain.admin_config import (
    AdminDocumentConfigSnapshot,
    AdminMenuConfigItem,
    AdminMenuConfigSnapshot,
)


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)


def _map_item(payload: dict, fallback_index: int) -> AdminMenuConfigItem:
    return AdminMenuConfigItem(
        item_id=str(payload["itemId"]),
        section_id=str(payload["sectionId"]),
        section_label=str(payload["sectionLabel"]),
        section_description=str(payload.get("sectionDescription") or ""),
        label=str(payload["label"]),
        href=str(payload["href"]) if payload.get("href") else None,
        description=str(payload.get("description") or ""),
        parent_item_id=str(payload["parentItemId"]) if payload.get("parentItemId") else None,
        node_type=str(payload.get("nodeType") or "page"),
        icon_key=str(payload.get("iconKey") or "SN"),
        required_roles=tuple(str(item) for item in payload.get("requiredRoles", [])),
        required_permissions=tuple(str(item) for item in payload.get("requiredPermissions", [])),
        sort_order=int(payload.get("sortOrder", fallback_index)),
        keywords=tuple(str(item) for item in payload.get("keywords", [])),
    )


def _serialize_item(item: AdminMenuConfigItem) -> dict:
    return {
        "itemId": item.item_id,
        "sectionId": item.section_id,
        "sectionLabel": item.section_label,
        "sectionDescription": item.section_description,
        "label": item.label,
        "href": item.href,
        "description": item.description,
        "parentItemId": item.parent_item_id,
        "nodeType": item.node_type,
        "iconKey": item.icon_key,
        "requiredRoles": list(item.required_roles),
        "requiredPermissions": list(item.required_permissions),
        "sortOrder": item.sort_order,
        "keywords": list(item.keywords),
    }


def _map_snapshot(row: dict) -> AdminMenuConfigSnapshot:
    draft_payload = row.get("draft_payload_json") or {}
    published_payload = row.get("published_payload_json") or {}
    draft_items = tuple(
        _map_item(payload, index)
        for index, payload in enumerate(draft_payload.get("items", []), start=1)
    )
    published_items = tuple(
        _map_item(payload, index)
        for index, payload in enumerate(published_payload.get("items", []), start=1)
    )
    return AdminMenuConfigSnapshot(
        config_key=row["config_key"],
        draft_items=draft_items,
        published_items=published_items,
        draft_version=row["draft_version"],
        published_version=row["published_version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
        published_at=row["published_at"],
        published_by=row["published_by"],
    )


def _map_document_snapshot(row: dict) -> AdminDocumentConfigSnapshot:
    return AdminDocumentConfigSnapshot(
        config_key=row["config_key"],
        draft_payload=dict(row.get("draft_payload_json") or {}),
        published_payload=dict(row.get("published_payload_json") or {}),
        draft_version=row["draft_version"],
        published_version=row["published_version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
        published_at=row["published_at"],
        published_by=row["published_by"],
    )


class PostgresAdminConfigRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def get_menu_config(self, config_key: str) -> AdminMenuConfigSnapshot | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_config_documents WHERE config_key = %s", (config_key,))
            row = cur.fetchone()
        return _map_snapshot(row) if row else None

    def save_menu_config(self, snapshot: AdminMenuConfigSnapshot) -> AdminMenuConfigSnapshot:
        draft_payload = {"items": [_serialize_item(item) for item in snapshot.draft_items]}
        published_payload = {"items": [_serialize_item(item) for item in snapshot.published_items]}
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_config_documents (
                    config_key,
                    draft_payload_json,
                    published_payload_json,
                    draft_version,
                    published_version,
                    created_at,
                    updated_at,
                    updated_by,
                    published_at,
                    published_by
                )
                VALUES (%s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()), %s, %s, %s)
                ON CONFLICT (config_key) DO UPDATE
                SET draft_payload_json = EXCLUDED.draft_payload_json,
                    published_payload_json = EXCLUDED.published_payload_json,
                    draft_version = EXCLUDED.draft_version,
                    published_version = EXCLUDED.published_version,
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by,
                    published_at = EXCLUDED.published_at,
                    published_by = EXCLUDED.published_by
                RETURNING *
                """,
                (
                    snapshot.config_key,
                    Jsonb(draft_payload),
                    Jsonb(published_payload),
                    snapshot.draft_version,
                    snapshot.published_version,
                    snapshot.created_at,
                    snapshot.updated_at,
                    snapshot.updated_by,
                    snapshot.published_at,
                    snapshot.published_by,
                ),
            )
            row = cur.fetchone()
        return _map_snapshot(row)

    def get_document_config(self, config_key: str) -> AdminDocumentConfigSnapshot | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_config_documents WHERE config_key = %s",
                (config_key,),
            )
            row = cur.fetchone()
        return _map_document_snapshot(row) if row else None

    def save_document_config(
        self, snapshot: AdminDocumentConfigSnapshot
    ) -> AdminDocumentConfigSnapshot:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_config_documents (
                    config_key,
                    draft_payload_json,
                    published_payload_json,
                    draft_version,
                    published_version,
                    created_at,
                    updated_at,
                    updated_by,
                    published_at,
                    published_by
                )
                VALUES (%s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()), %s, %s, %s)
                ON CONFLICT (config_key) DO UPDATE
                SET draft_payload_json = EXCLUDED.draft_payload_json,
                    published_payload_json = EXCLUDED.published_payload_json,
                    draft_version = EXCLUDED.draft_version,
                    published_version = EXCLUDED.published_version,
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by,
                    published_at = EXCLUDED.published_at,
                    published_by = EXCLUDED.published_by
                RETURNING *
                """,
                (
                    snapshot.config_key,
                    Jsonb(snapshot.draft_payload),
                    Jsonb(snapshot.published_payload),
                    snapshot.draft_version,
                    snapshot.published_version,
                    snapshot.created_at,
                    snapshot.updated_at,
                    snapshot.updated_by,
                    snapshot.published_at,
                    snapshot.published_by,
                ),
            )
            row = cur.fetchone()
        return _map_document_snapshot(row)
