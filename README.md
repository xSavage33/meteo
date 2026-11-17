# Meteo - Estacion ambiental ESP32

ESP32 + DHT11 + OLED, API FastAPI con SQLite y dashboard web para Dokploy.

## Dokploy
1. Build type Dockerfile, build path `servidor`.
2. Variable de entorno `DEVICE_TOKEN`.
3. Volumen montado en `/app/data`.
4. Dominio con HTTPS, puerto 8000.

## Firmware
Copiar `secrets.example.h` a `secrets.h`, completarlo y subir con Arduino IDE.