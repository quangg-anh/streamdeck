import { z } from "zod";
import { effectActionSchema, queueModeSchema } from "@streamfx/protocol";

export const idParams = z.object({ id: z.string().min(1) });
export const childParams = z.object({ id: z.string().min(1), childId: z.string().min(1) });
export const fireParams = z.object({ id: z.string().min(1), effectId: z.string().min(1) });
export const projectInput = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).default("") });
export const projectPatch = projectInput.partial().refine(value => Object.keys(value).length > 0);
export const effectInput = z.object({ name: z.string().trim().min(1).max(80), actions: z.array(effectActionSchema).min(1).max(20), mode: queueModeSchema.default("QUEUE"), cooldownMs: z.number().int().min(0).max(3600000).default(0), enabled: z.boolean().default(true) });
export const effectPatch = effectInput.partial().refine(value => Object.keys(value).length > 0);
export const buttonInput = z.object({ label: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"), icon: z.string().max(20).nullable().optional(), effectId: z.string().min(1), position: z.number().int().min(0).default(0), enabled: z.boolean().default(true), cooldownMs: z.number().int().min(0).max(3600000).default(0) });
export const buttonPatch = buttonInput.partial().refine(value => Object.keys(value).length > 0);
export const triggerInput = z.object({ provider: z.enum(["mock", "tiktok"]).default("mock"), event: z.string().trim().min(1).max(80), match: z.string().max(200).nullable().optional(), effectId: z.string().min(1), cooldownMs: z.number().int().min(0).max(3600000).default(5000), enabled: z.boolean().default(true), config: z.record(z.string(), z.unknown()).nullable().optional() });
export const triggerPatch = triggerInput.partial().refine(value => Object.keys(value).length > 0);
export const settingsPatch = z.object({ ttsEnabled: z.boolean(), ttsMaxLength: z.number().int().min(1).max(1000), ttsRate: z.number().min(0.5).max(2), ttsVoice: z.string().max(100).nullable(), volume: z.number().min(0).max(1), queueLimit: z.number().int().min(1).max(200), developerMode: z.boolean(), allowMockEvents: z.boolean() }).partial().refine(value => Object.keys(value).length > 0);
export const controlInput = z.object({ type: z.enum(["clear", "stop"]) });
export const eventInput = z.object({ provider: z.enum(["mock", "tiktok"]), type: z.string().trim().min(1).max(80), value: z.string().max(200).optional(), user: z.string().max(100).optional(), metadata: z.record(z.string(), z.unknown()).optional() });

export const loginInput = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, "Chỉ chữ, số, dấu chấm, gạch dưới"), password: z.string().min(8).max(200) });
export const passwordInput = z.object({ password: z.string().min(8).max(200) });
export const userCreateInput = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, "Chỉ chữ, số, dấu chấm, gạch dưới"), password: z.string().min(8).max(200), role: z.enum(["ADMIN", "USER"]).default("USER"), deckLimit: z.number().int().min(0).max(1000).optional(), planDays: z.number().int().min(0).max(3650).optional() }).transform(value => ({ ...value, deckLimit: value.deckLimit ?? 0, planDays: value.planDays ?? 0 }));
export const userPatchInput = z.object({ password: z.string().min(8).max(200).optional(), role: z.enum(["ADMIN", "USER"]).optional(), blocked: z.boolean().optional(), deckLimit: z.number().int().min(0).max(1000).optional(), planDays: z.number().int().min(0).max(3650).optional() }).refine(value => Object.keys(value).length > 0);
export const projectGrantInput = z.object({ deckLimit: z.number().int().min(0).max(1000).optional(), planDays: z.number().int().min(0).max(3650).optional() }).refine(value => Object.keys(value).length > 0);
