# Tablero Financiero

- `config.json`: componentes (monedas, bonos, commodities, índices, acciones) y fuentes. Para agregar uno, sumar un objeto y correr el recolector.
- `collector.mjs`: baja los datos (Yahoo Finance, Ámbito, data912) y escribe `data/latest.js`. `node collector.mjs`
- `server.mjs` + `index.html`: tablero en http://localhost:8080 (`node server.mjs`).
- `programar_tarea.ps1`: recarga automática cada 15 min en horario de mercado.

Fuentes sin API pública o con licencia (Investing.com, Bloomberg, Infobae Profesional, Cronista) quedan como adaptadores reservados.
Los datos son informativos y pueden tener demora; no constituyen asesoramiento financiero.
