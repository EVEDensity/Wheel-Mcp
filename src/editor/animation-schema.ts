import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const finite = z.number().finite().min(-100000).max(100000);
const key = z
  .object({
    time: z.number().finite().min(0).max(60),
    value: z.union([
      z.object({ x: finite, y: finite }).strict(),
      z.object({ x: finite, y: finite, z: finite }).strict(),
    ]),
  })
  .strict();
const base = { id, target: z.string().min(1).max(128) };
const timed = { time: z.number().finite().min(0).max(60) };
const scaleAxis = z.number().finite().min(0.0625).max(16);
const track = z.discriminatedUnion('property', [
  z.object({ ...base, property: z.literal('position'), keys: z.array(key).min(1).max(32) }).strict(),
  z
    .object({
      ...base,
      property: z.literal('rotation'),
      keys: z
        .array(z.object({ ...timed, value: z.number().finite().min(-32).max(32) }).strict())
        .min(1)
        .max(32),
    })
    .strict(),
  z
    .object({
      ...base,
      property: z.literal('scale'),
      keys: z
        .array(z.object({ ...timed, value: z.object({ x: scaleAxis, y: scaleAxis }).strict() }).strict())
        .min(1)
        .max(32),
    })
    .strict(),
]);
const clip = z
  .object({
    id,
    length: z.number().finite().min(0.01).max(60),
    loop: z.boolean(),
    tracks: z.array(track).min(1).max(8),
  })
  .strict();

export const animationClipsSchema = z
  .array(clip)
  .min(1)
  .max(8)
  .superRefine((clips, context) => {
    const ids = new Set<string>();
    for (const [ci, item] of clips.entries()) {
      if (ids.has(item.id)) context.addIssue({ code: 'custom', message: 'Duplicate clip ID', path: [ci, 'id'] });
      ids.add(item.id);
      const tracks = new Set<string>();
      const channels = new Set<string>();
      for (const [ti, channel] of item.tracks.entries()) {
        if (tracks.has(channel.id))
          context.addIssue({ code: 'custom', message: 'Duplicate track ID', path: [ci, 'tracks', ti, 'id'] });
        tracks.add(channel.id);
        const address = JSON.stringify([channel.target, channel.property]);
        if (channels.has(address))
          context.addIssue({ code: 'custom', message: 'Duplicate target property', path: [ci, 'tracks', ti] });
        channels.add(address);
        let previous = -1;
        for (const [ki, frame] of channel.keys.entries()) {
          if (frame.time <= previous || frame.time > item.length)
            context.addIssue({
              code: 'custom',
              message: 'Key times must be strictly ascending and within clip',
              path: [ci, 'tracks', ti, 'keys', ki, 'time'],
            });
          previous = frame.time;
        }
      }
    }
  });

export const animationGraphSchema = z
  .object({
    playerPath: z.string().min(1).max(128),
    entry: id,
    states: z
      .array(z.object({ id, label: z.string().min(1).max(64), clip: id }).strict())
      .min(2)
      .max(8),
    transitions: z
      .array(z.object({ id, from: id, to: id, condition: id }).strict())
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine((graph, context) => {
    const states = new Set<string>();
    const transitions = new Set<string>();
    const conditions = new Set<string>();
    for (const [index, state] of graph.states.entries()) {
      if (states.has(state.id))
        context.addIssue({ code: 'custom', message: 'Duplicate state ID', path: ['states', index, 'id'] });
      states.add(state.id);
    }
    if (!states.has(graph.entry)) context.addIssue({ code: 'custom', message: 'Entry state missing', path: ['entry'] });
    const edges = new Map<string, string[]>();
    for (const [index, edge] of graph.transitions.entries()) {
      if (transitions.has(edge.id))
        context.addIssue({ code: 'custom', message: 'Duplicate transition ID', path: ['transitions', index, 'id'] });
      transitions.add(edge.id);
      const conditionKey = `${edge.from}/${edge.condition}`;
      if (conditions.has(conditionKey))
        context.addIssue({
          code: 'custom',
          message: 'Ambiguous condition from one state',
          path: ['transitions', index, 'condition'],
        });
      conditions.add(conditionKey);
      if (!states.has(edge.from) || !states.has(edge.to) || edge.from === edge.to)
        context.addIssue({ code: 'custom', message: 'Invalid transition endpoint', path: ['transitions', index] });
      edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge.to]);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (state: string): boolean => {
      if (visiting.has(state)) return true;
      if (visited.has(state)) return false;
      visiting.add(state);
      for (const next of edges.get(state) ?? []) if (walk(next)) return true;
      visiting.delete(state);
      visited.add(state);
      return false;
    };
    for (const state of states)
      if (walk(state)) {
        context.addIssue({ code: 'custom', message: 'Automatic transition cycle', path: ['transitions'] });
        break;
      }
    const reachable = new Set<string>();
    const queue = [graph.entry];
    while (queue.length) {
      const current = queue.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      queue.push(...(edges.get(current) ?? []));
    }
    for (const state of states)
      if (!reachable.has(state))
        context.addIssue({ code: 'custom', message: 'State is unreachable from entry', path: ['states'] });
  });

export const animationBlendSchema = z
  .object({
    playerPath: z.string().min(1).max(128),
    left: z.object({ id, clip: id }).strict(),
    right: z.object({ id, clip: id }).strict(),
    blendId: id,
  })
  .strict()
  .refine((value) => new Set([value.left.id, value.right.id, value.blendId, 'output']).size === 4, {
    message: 'Blend node IDs must be distinct and not reserved',
  });
