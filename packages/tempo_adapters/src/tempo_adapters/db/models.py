"""Database tables (Clawback spec §5.6). Money is NUMERIC, never float; times are timestamptz.

Ledger and event tables hold ids and numbers, never names, phone numbers or addresses.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

MONEY = Numeric(12, 2)
MINUTES = Numeric(10, 1)
TS = DateTime(timezone=True)

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    phone_hash: Mapped[str | None] = mapped_column(String(64), unique=True)  # never the number
    display_name: Mapped[str] = mapped_column(String(80))
    language: Mapped[str] = mapped_column(String(16), default="en-GB")
    time_value_gbp_h: Mapped[Decimal] = mapped_column(MONEY)
    accessibility_prefs: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    safe_word_hash: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(TS)


class MissionRow(Base):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    skill_id: Mapped[str] = mapped_column(String(128))
    goal: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(32))
    entered_state_at: Mapped[datetime] = mapped_column(TS)
    entitlement_gbp: Mapped[Decimal | None] = mapped_column(MONEY)
    proof_trace: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    decision: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TS)


class ConsentRow(Base):
    """Append-only: a database trigger refuses UPDATE and DELETE (docs/adr/0004)."""

    __tablename__ = "consents"
    __table_args__ = (CheckConstraint("kind IN ('grant', 'revoke')", name="kind"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    scope: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(8))
    at: Mapped[datetime] = mapped_column(TS)
    expires_at: Mapped[datetime | None] = mapped_column(TS)
    limits: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    device_sig: Mapped[str] = mapped_column(Text)


class CaseEvent(Base):
    __tablename__ = "case_events"
    __table_args__ = (Index("ix_case_events_mission_at", "mission_id", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"))
    at: Mapped[datetime] = mapped_column(TS)
    from_state: Mapped[str] = mapped_column(String(32))
    to_state: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(16))  # agent | user | company | system
    latency_ms: Mapped[int] = mapped_column(Integer)


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    uri: Mapped[str] = mapped_column(Text)  # the vault object, never the content
    sha256: Mapped[str] = mapped_column(String(64))
    mime_type: Mapped[str] = mapped_column(String(64))
    captured_at: Mapped[datetime] = mapped_column(TS)


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id"), index=True)
    direction: Mapped[str] = mapped_column(String(8))  # inbound | outbound
    started_at: Mapped[datetime] = mapped_column(TS)
    ended_at: Mapped[datetime | None] = mapped_column(TS)
    hold_seconds: Mapped[int] = mapped_column(Integer, default=0)
    transcript_uri: Mapped[str | None] = mapped_column(Text)
    reference: Mapped[str | None] = mapped_column(String(64))  # the company's case reference


class StallEvent(Base):
    __tablename__ = "stall_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"), index=True)
    at: Mapped[datetime] = mapped_column(TS)
    company: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(40))
    quote: Mapped[str] = mapped_column(Text)  # what the company said, not what the person said


class TimeLedgerRow(Base):
    __tablename__ = "time_ledger"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    mission_id: Mapped[str | None] = mapped_column(ForeignKey("missions.id"))
    at: Mapped[datetime] = mapped_column(TS)
    company: Mapped[str | None] = mapped_column(String(80))
    minutes_lost: Mapped[Decimal] = mapped_column(MINUTES, default=Decimal(0))
    minutes_returned: Mapped[Decimal] = mapped_column(MINUTES, default=Decimal(0))
    gbp_recovered: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0))
    entry_key: Mapped[str | None] = mapped_column(String(128), unique=True)  # idempotency


class RulePackRow(Base):
    __tablename__ = "rule_packs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    version: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    operator: Mapped[str] = mapped_column(String(80))
    scheme: Mapped[str] = mapped_column(String(80))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    citation_url: Mapped[str] = mapped_column(Text)
    demo_values: Mapped[bool] = mapped_column(Boolean)
    last_verified: Mapped[date | None] = mapped_column(Date)
