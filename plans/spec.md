# 📄 Technical Specification

## Project: Reflection-Driven Roguelike (ROT.js + Nostr)

---

## 1. Purpose

Create a browser roguelike game that generates playable dungeon levels from **AI work session reflections** published via Nostr.

The game visualizes developer activity as:

* obstacles → enemies
* acquisitions → items
* metrics → gameplay parameters
* session reflection → level narrative

The frontend must remain **Vanilla JS + HTML**, no frameworks.

---

## 2. System Overview

### External Flow

```
Nanobot
   ↓
collect logs
   ↓
LLM reflection JSON
   ↓
Nostr Event (kind: 31337)
   ↓
Game subscribes
   ↓
Level Builder
   ↓
Playable dungeon
```

---

## 3. Architecture (Frontend)

### Core Modules

#### 3.1 NostrConnector

Responsible for:

* connecting to relay
* subscribing to nanobot pubkey
* filtering reflection events
* parsing JSON content

**Responsibilities**

* connect websocket
* subscribe by:

  * pubkey
  * tag `t=reflection`
* emit internal events

**API**

```js
nostrConnector.connect()
nostrConnector.subscribe(pubkey)
nostrConnector.onReflection(callback)
```

---

#### 3.2 ReflectionParser

Transforms raw Nostr event into internal game model.

Input:

```
Nostr Event
```

Output:

```
ReflectionModel
```

Example:

```js
{
  sessionId,
  difficulty,
  enemies,
  items,
  energyCurve,
  narrative
}
```

---

#### 3.3 LevelBuilder

Pure procedural generator.

Transforms:

```
ReflectionModel → Dungeon Layout
```

Uses:

* ROT.Map.Digger
* ROT.Path
* ROT.RNG

Responsibilities:

* generate rooms
* place enemies
* spawn items
* apply difficulty scaling

---

#### 3.4 LevelManager

Game lifecycle controller.

Responsibilities:

* load new level
* destroy old level
* manage player spawn
* session switching

API:

```js
levelManager.load(reflectionModel)
levelManager.restart()
```

---

#### 3.5 EntityFactory

Creates game entities from reflection data.

Creates:

* enemies
* items
* player modifiers

Example:

```js
EntityFactory.createEnemy(obstacle)
EntityFactory.createItem(acquisition)
```

---

#### 3.6 GameRenderer

Already partially exists in roguelike.

Responsibilities:

* draw map
* draw entities
* animate updates

No redesign required.

---

## 4. Data Contract (Reflection JSON)

Nanobot sends:

```json
{
  "session_id": "...",
  "reflection": {
    "goal": "",
    "outcome": "",
    "summary": ""
  },
  "metrics": {
    "duration_minutes": 135,
    "tool_calls": 4,
    "focus_score": 0.7,
    "friction": 0.3
  },
  "obstacles": [],
  "acquisitions": [],
  "energy_curve": []
}
```

---

## 5. Game Mapping Rules (MOST IMPORTANT)

### Difficulty

```js
difficulty =
  tool_calls * 0.5 +
  friction * 10 -
  focus_score * 5
```

---

### Obstacles → Enemies

Each obstacle becomes enemy.

| JSON field  | Game meaning |
| ----------- | ------------ |
| archetype   | enemy class  |
| intensity   | HP           |
| name        | enemy name   |
| description | lore         |

Example:

```js
hp = 10 + intensity * 20
```

Enemy types:

* blocker → tank
* confusion → random walker
* retry_loop → respawner

---

### Acquisitions → Items

Each acquisition becomes item.

| JSON  | Game       |
| ----- | ---------- |
| type  | item class |
| value | strength   |
| name  | item name  |

Examples:

* insight → scroll
* tool → weapon
* skill → passive buff

---

### Metrics → World Parameters

| Metric           | Effect        |
| ---------------- | ------------- |
| duration_minutes | map size      |
| tool_calls       | enemy count   |
| focus_score      | light radius  |
| friction         | traps density |

---

### Energy Curve → Level Zones

Energy curve defines difficulty progression across map.

Example:

```
low energy → dark rooms
high energy → treasure rooms
```

---

## 6. Event Flow

```
Game Start
   ↓
NostrConnector.connect()
   ↓
Subscribe to nanobot
   ↓
Reflection received
   ↓
ReflectionParser
   ↓
LevelBuilder
   ↓
LevelManager.load()
   ↓
Player plays session
```

---

## 7. Constraints

✅ Vanilla JS only
✅ No React/Vue rewrite
✅ rot.js must remain renderer/engine
✅ Works offline after level generation
✅ Multiple sessions = multiple levels

---

## 8. Required Files Structure

```
/game
  index.html
  main.js

/nostr
  NostrConnector.js

/reflection
  ReflectionParser.js

/level
  LevelBuilder.js
  LevelManager.js

/entities
  EntityFactory.js
```

---

## 9. Non-Goals

* No backend server
* No database
* No authentication logic
* No game framework migration

---

## 10. Implementation Order (for Codex)

1. Implement NostrConnector
2. Parse reflection events
3. Convert reflection → model
4. Spawn static level from JSON
5. Add enemies/items mapping
6. Auto-load new sessions as levels
