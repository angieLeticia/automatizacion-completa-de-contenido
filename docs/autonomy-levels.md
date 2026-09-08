# Niveles de autonomía — Fase 2

> No declarar autonomía por tener un scheduler. Cada nivel exige condiciones objetivas y
> verificables, no una intención de diseño.

## Niveles

| Nivel | Nombre | Condición objetiva |
|---|---|---|
| **0** | Manual | Una persona ejecuta cada paso a mano, sin script ni watcher. |
| **1** | Automatizado pero dependiente | Corre sin supervisión *dentro de una invocación ya iniciada por un humano*, pero no se auto-arranca ni se auto-programa. |
| **2** | Semiautónomo | Tiene un disparador que se auto-arranca (scheduler/watcher), pero requiere un gate humano explícito en al menos un punto del ciclo (autorización). |
| **3** | Autónomo supervisado | Corre de punta a punta sin gate humano en el camino feliz, con recuperación automática demostrada, idempotencia en las 3 capas (episodio/archivo/publicación) y observabilidad suficiente para que un humano detecte y entienda un fallo sin intervenir en el flujo. |
| **4** | Autónomo operacional | Nivel 3 + track record demostrado (N ciclos reales sin intervención) + alertas activas ante fallo repetido + capacidad de rollback/pausa por canal + multi-canal sin cambio de código por canal (solo config/BD). |

## Clasificación real de cada componente hoy (evidencia de Fases 0-1.2, no aspiracional)

| Componente | Nivel real hoy | Por qué |
|---|---|---|
| Ingesta / Inbox (nueva, aún no implementada) | — (no existe) | Es diseño puro en esta fase |
| Agente de investigación opcional (antiguo "Agente 1") | 🟠 **Nivel 1** | Corre sin intervención dentro de una sesión ya iniciada (demostrado: 8 proyectos en un ciclo), pero no tiene disparador propio — sigue dependiendo de que alguien abra la sesión (EVIDENCIA, Fase 0.1/1.2) |
| Agente 2 — render (`scripts/pipeline`) | 🟡 **Nivel 2** | Tiene tarea de Windows que se auto-arranca (`VisteapyAgentProduccion`) y recovery real de crashes, pero exige `pipeline:authorize` humano antes de encolar — gate deliberado, no ausencia de autonomía (EVIDENCIA) |
| Agente 3 — Flujo A (legacy) | 🔴 **Nivel 0 efectivo** | El workflow nunca fue desplegado a GitHub (EVIDENCIA, Fase 1.2) — hoy no corre en absoluto pese a estar "programado" en el código |
| Agente 3 — Flujo B (endurecido) | 🟠 **Nivel 1** | Corre correctamente si se invoca a mano; nunca tuvo scheduler (EVIDENCIA) |
| Orquestador (nuevo, aún no implementado) | — (no existe) | Diseño puro en esta fase |

**Ningún componente del sistema alcanza hoy el Nivel 3.** Esto no es un fallo del diseño anterior
— es la razón por la que esta auditoría se hizo antes de escribir código nuevo.

## Criterios definitivos para declarar autonomía real (Nivel 3 en adelante)

No basta con cumplir uno — se exige la lista completa, por componente:

1. No depende de que una persona inicie una conversación/sesión para cada corrida.
2. Recuperación automática demostrada (no solo diseñada) ante al menos: crash de proceso, PC
   apagada, Supabase temporalmente inalcanzable.
3. Idempotencia verificada en las tres capas (`docs/system-contracts.md` §1): episodio, archivo,
   publicación — no solo "existe un hash".
4. Observabilidad suficiente para responder "¿qué pasó con el episodio X?" sin acceso a los
   logs de una máquina específica.
5. Gates explícitos y auditables (quién autorizó qué, cuándo, con qué evidencia).
6. Secretos fuera del código y fuera de los logs — verificado, no asumido.
7. Publicación con claim atómico + verificación de identidad de cuenta/canal, siempre, sin
   excepción por origen del contenido (fin de "Flujo A vs Flujo B").
8. Límites duros configurados: `MAX_RETRIES`, `max_posts_per_day`, límites de tamaño/tiempo por
   etapa — y **probados** con un caso real que los dispare, no solo declarados en config.
9. Capacidad de pausar/despublicar un canal específico sin afectar a los demás.
10. Alertas ante fallo repetido — no silencioso, no solo un log que nadie lee.
11. Pruebas automatizadas de cada gate (no solo pruebas manuales puntuales como las de
    `scripts/pipeline/test-authorization-gate.mts`, que ya existen pero no corren en CI).
12. Persistencia de estado que sobreviva un reinicio de proceso o de la PC — ya demostrado
    parcialmente por Agente 2 (`requeueStuckProcessing`), pendiente para el resto.
13. Scheduler que se auto-arranca sin intervención humana — pendiente para Ingesta/Agente 3.
14. Multi-canal sin tocar código por canal — pendiente (`ACCOUNTS` hardcodeado hoy).

Ninguna fase futura debe declarar "el sistema es autónomo" sin poder marcar los 14 puntos con
evidencia, no con intención.
