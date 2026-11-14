# NASA Space Apps Challenge
## Hackathon 2026

**Project:** Lunar Landing Site Navigator

## Lunar-site geometry API

The backend accepts frontend coordinates and time intervals at `POST /api/lunar-geometry`.
See [the request contract, frontend example and deployment instructions](backend/LUNAR_GEOMETRY.md).

## Lunar topography experiments

- [Pruebas_COG_LOLA.ipynb](Pruebas_COG_LOLA.ipynb): experimental terrain, horizon and visibility evaluation with remote LOLA/SLDEM2015 data.
- [Execution guide and limitations](Pruebas_COG_LOLA/README.md).
- [Notebook requirements](Pruebas_COG_LOLA/requirements.txt).

**Data:** [NASA PGDA LOLA products](https://pgda.gsfc.nasa.gov/products/90).

## Project rule

- **AI use must be documented:** Record every use of AI in writing so it can be reported. Include what AI was used for and how its output was used in the project.

## Agent skills

Skills available to agents working in this repository:


- **[threejs-r3f](.agents/skills/threejs-r3f/SKILL.md)** — Build and fix React Three Fiber scenes, including Drei helpers, loading, events, and React lifecycle integration.
- **[web-design-guidelines](.agents/skills/web-design-guidelines/SKILL.md)** — Review the interface for accessibility, usability, and Web Interface Guidelines compliance.
