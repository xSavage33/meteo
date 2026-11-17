import hmac
import os
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("DB_PATH", "estacion.db")
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", "")
MAX_POST_POR_MINUTO = int(os.environ.get("MAX_POST_POR_MINUTO", "12"))

if len(DEVICE_TOKEN) < 16:
    raise SystemExit("DEVICE_TOKEN no definido o demasiado corto (minimo 16 caracteres)")

app = FastAPI(title="Meteo", docs_url=None, redoc_url=None, openapi_url=None)


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


ESQUEMA = """
CREATE TABLE IF NOT EXISTS lecturas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    temperatura REAL NOT NULL,
    humedad     REAL NOT NULL,
    rssi        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lecturas_ts ON lecturas(ts);

CREATE TABLE IF NOT EXISTS dispositivo (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    ssid    TEXT,
    ip      TEXT,
    fw      TEXT,
    uptime  INTEGER,
    rssi    INTEGER,
    visto   TEXT
);
"""

with db() as c:
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(ESQUEMA)
    columnas = {r["name"] for r in c.execute("PRAGMA table_info(lecturas)")}
    if "rssi" not in columnas:
        c.execute("ALTER TABLE lecturas ADD COLUMN rssi INTEGER")


_solicitudes: dict = defaultdict(deque)


def limitar_tasa(ip: str):
    ahora = time.monotonic()
    cola = _solicitudes[ip]
    while cola and ahora - cola[0] > 60:
        cola.popleft()
    if len(cola) >= MAX_POST_POR_MINUTO:
        raise HTTPException(status_code=429, detail="Demasiadas solicitudes")
    cola.append(ahora)


def verificar_token(authorization: Optional[str]):
    esperado = f"Bearer {DEVICE_TOKEN}"
    if not authorization or not hmac.compare_digest(authorization.encode(), esperado.encode()):
        raise HTTPException(status_code=401, detail="No autorizado")


@app.middleware("http")
async def cabeceras_seguridad(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'"
    )
    return resp


class Lectura(BaseModel):
    temperatura: float = Field(ge=-20, le=70)
    humedad: float = Field(ge=0, le=100)
    rssi: Optional[int] = Field(default=None, ge=-120, le=0)
    uptime: Optional[int] = Field(default=None, ge=0, le=10**9)
    ssid: Optional[str] = Field(default=None, max_length=32)
    ip: Optional[str] = Field(default=None, max_length=45)
    fw: Optional[str] = Field(default=None, max_length=20)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/lecturas", status_code=201)
def recibir(lectura: Lectura, request: Request, authorization: Optional[str] = Header(None)):
    limitar_tasa(request.client.host if request.client else "desconocido")
    verificar_token(authorization)
    with db() as c:
        c.execute(
            "INSERT INTO lecturas (temperatura, humedad, rssi) VALUES (?, ?, ?)",
            (lectura.temperatura, lectura.humedad, lectura.rssi),
        )
        c.execute(
            """
            INSERT INTO dispositivo (id, ssid, ip, fw, uptime, rssi, visto)
            VALUES (1, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                ssid = excluded.ssid, ip = excluded.ip, fw = excluded.fw,
                uptime = excluded.uptime, rssi = excluded.rssi, visto = excluded.visto
            """,
            (lectura.ssid, lectura.ip, lectura.fw, lectura.uptime, lectura.rssi),
        )
    return {"ok": True}


@app.get("/api/actual")
def actual():
    with db() as c:
        lectura = c.execute(
            "SELECT ts, temperatura, humedad, rssi FROM lecturas ORDER BY id DESC LIMIT 1"
        ).fetchone()
        dispositivo = c.execute(
            "SELECT ssid, ip, fw, uptime, rssi, visto FROM dispositivo WHERE id = 1"
        ).fetchone()
    return {
        "lectura": dict(lectura) if lectura else None,
        "dispositivo": dict(dispositivo) if dispositivo else None,
    }


def tamano_bucket(horas: int) -> int:
    if horas <= 1:
        return 60
    if horas <= 24:
        return 600
    if horas <= 168:
        return 3600
    return 14400


@app.get("/api/historico")
def historico(horas: int = Query(24, ge=1, le=720)):
    b = tamano_bucket(horas)
    with db() as c:
        filas = c.execute(
            """
            SELECT strftime('%Y-%m-%dT%H:%M:%SZ',
                            (CAST(strftime('%s', ts) AS INTEGER) / :b) * :b,
                            'unixepoch')          AS t,
                   round(avg(temperatura), 1)     AS temp,
                   round(avg(humedad), 1)         AS hum,
                   count(*)                       AS n
            FROM lecturas
            WHERE ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', :desde)
            GROUP BY t
            ORDER BY t
            """,
            {"b": b, "desde": f"-{horas} hours"},
        ).fetchall()
    return [dict(f) for f in filas]


@app.get("/api/resumen")
def resumen(horas: int = Query(24, ge=1, le=720)):
    with db() as c:
        fila = c.execute(
            """
            SELECT round(avg(temperatura), 1) AS temp_avg,
                   min(temperatura)           AS temp_min,
                   max(temperatura)           AS temp_max,
                   round(avg(humedad), 1)     AS hum_avg,
                   min(humedad)               AS hum_min,
                   max(humedad)               AS hum_max,
                   count(*)                   AS muestras
            FROM lecturas
            WHERE ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
            """,
            (f"-{horas} hours",),
        ).fetchone()
    return dict(fila)


app.mount("/", StaticFiles(directory="static", html=True), name="static")