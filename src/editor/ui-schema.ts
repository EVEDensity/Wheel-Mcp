import { z } from 'zod';
export const uiTypes = [
  'Button',
  'CheckButton',
  'HSlider',
  'LineEdit',
  'ScrollContainer',
  'PanelContainer',
  'MarginContainer',
  'VBoxContainer',
  'HBoxContainer',
  'GridContainer',
] as const;
const coordinate = z.number().finite().min(-100000).max(100000);
export const uiPropertiesSchema = z
  .object({
    anchor_left: z.number().min(0).max(1).optional(),
    anchor_top: z.number().min(0).max(1).optional(),
    anchor_right: z.number().min(0).max(1).optional(),
    anchor_bottom: z.number().min(0).max(1).optional(),
    offset_left: coordinate.optional(),
    offset_top: coordinate.optional(),
    offset_right: coordinate.optional(),
    offset_bottom: coordinate.optional(),
    custom_minimum_size: z
      .object({
        type: z.literal('Vector2'),
        x: z.number().finite().min(0).max(100000),
        y: z.number().finite().min(0).max(100000),
      })
      .strict()
      .optional(),
    size_flags_horizontal: z.number().int().min(0).max(15).optional(),
    size_flags_vertical: z.number().int().min(0).max(15).optional(),
    size_flags_stretch_ratio: z.number().finite().positive().max(1000).optional(),
    grow_horizontal: z.number().int().min(0).max(2).optional(),
    grow_vertical: z.number().int().min(0).max(2).optional(),
    text: z.string().max(512).optional(),
    placeholder_text: z.string().max(512).optional(),
    editable: z.boolean().optional(),
    max_length: z.number().int().min(0).max(512).optional(),
    horizontal_scroll_mode: z.number().int().min(0).max(4).optional(),
    vertical_scroll_mode: z.number().int().min(0).max(4).optional(),
    follow_focus: z.boolean().optional(),
    accessibility_name: z.string().max(128).optional(),
    accessibility_description: z.string().max(512).optional(),
    tooltip_text: z.string().max(512).optional(),
    focus_mode: z.number().int().min(0).max(2).optional(),
    mouse_filter: z.number().int().min(0).max(2).optional(),
    autowrap_mode: z.number().int().min(0).max(3).optional(),
    columns: z.number().int().min(1).max(12).optional(),
    min_value: coordinate.optional(),
    max_value: coordinate.optional(),
    step: z.number().finite().positive().max(100000).optional(),
    value: coordinate.optional(),
    disabled: z.boolean().optional(),
    button_pressed: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 16, 'Expected 1..16 declared UI properties');
