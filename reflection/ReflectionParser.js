const ENEMY_CLASS_BY_ARCHETYPE = {
  blocker: 'tank',
  confusion: 'random_walker',
  retry_loop: 'respawner'
};

const ITEM_CLASS_BY_TYPE = {
  insight: 'scroll',
  tool: 'weapon',
  skill: 'passive_buff',
  pattern: 'passive_buff'
};

function numberOr(value, fallback) {
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function tagValue(tags, tagName) {
  if (!Array.isArray(tags)) return '';
  const entry = tags.find((tag) => Array.isArray(tag) && tag[0] === tagName && typeof tag[1] === 'string');
  return entry ? entry[1] : '';
}

export class ReflectionParser {
  parseEvent(nostrEvent) {
    if (!nostrEvent || typeof nostrEvent.content !== 'string') {
      throw new Error('Invalid Nostr event: missing content');
    }

    let payload;
    try {
      payload = JSON.parse(nostrEvent.content);
    } catch (_) {
      throw new Error('Invalid Nostr event: content is not JSON');
    }

    const sessionIdFromTag = tagValue(nostrEvent.tags, 'd');
    const model = this.parsePayload(payload);
    return {
      ...model,
      sessionId: model.sessionId || sessionIdFromTag || `session-${Date.now()}`,
      createdAt: numberOr(payload.timestamp, numberOr(nostrEvent.created_at, Date.now()))
    };
  }

  parsePayload(payload) {
    const metrics = payload.metrics || {};
    const toolCalls = numberOr(metrics.tool_calls, 0);
    const friction = numberOr(metrics.friction, 0);
    const focusScore = numberOr(metrics.focus_score, 0);

    const difficulty = toolCalls * 0.5 + friction * 10 - focusScore * 5;

    const enemies = Array.isArray(payload.obstacles)
      ? payload.obstacles.map((obstacle, index) => {
          const intensity = numberOr(obstacle?.intensity, 0.2);
          return {
            id: obstacle?.id || `enemy-${index}`,
            archetype: obstacle?.archetype || 'blocker',
            className: ENEMY_CLASS_BY_ARCHETYPE[obstacle?.archetype] || 'tank',
            intensity,
            hp: Math.max(3, Math.round(10 + intensity * 20)),
            name: obstacle?.name || `Obstacle ${index + 1}`,
            description: obstacle?.description || ''
          };
        })
      : [];

    const items = Array.isArray(payload.acquisitions)
      ? payload.acquisitions.map((acquisition, index) => {
          const value = numberOr(acquisition?.value, 1);
          return {
            id: acquisition?.id || `item-${index}`,
            type: acquisition?.type || 'insight',
            className: ITEM_CLASS_BY_TYPE[acquisition?.type] || 'scroll',
            value,
            name: acquisition?.name || `Acquisition ${index + 1}`
          };
        })
      : [];

    const reflection = payload.reflection || {};
    const narrative = [reflection.goal, reflection.outcome, reflection.summary].filter(Boolean).join(' ');

    return {
      sessionId: payload.session_id || '',
      difficulty,
      enemies,
      items,
      energyCurve: Array.isArray(payload.energy_curve) ? payload.energy_curve : [],
      narrative,
      metrics: {
        durationMinutes: numberOr(metrics.duration_minutes, 45),
        toolCalls,
        focusScore,
        friction
      },
      raw: payload
    };
  }
}

export const reflectionParser = new ReflectionParser();
