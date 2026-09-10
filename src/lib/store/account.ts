/**
 * Product state and entitlements.
 *
 * No billing, no signup, no gating. This exists so the eventual credit model
 * has a shape to slot into, and so the app can count what it has done locally.
 * Nothing here blocks a separation today, and `enforce` is off by default.
 */

import type { AccountState, Entitlements, PlanTier } from "@/lib/types";
import { readJson, writeJson, STORAGE_KEYS } from "./storage";

export const TIER_ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  FREE: {
    tier: "FREE",
    separationCredits: 1,
    maxScreens: null,
    savedJobs: 1,
    premiumExports: false,
    advancedOptimization: false,
    shopPresets: true,
    batchJobs: false,
  },
  PAY_PER_JOB: {
    tier: "PAY_PER_JOB",
    separationCredits: null,
    maxScreens: null,
    savedJobs: 5,
    premiumExports: true,
    advancedOptimization: false,
    shopPresets: true,
    batchJobs: false,
  },
  CREATOR: {
    tier: "CREATOR",
    separationCredits: 20,
    maxScreens: null,
    savedJobs: 25,
    premiumExports: true,
    advancedOptimization: false,
    shopPresets: true,
    batchJobs: false,
  },
  SHOP: {
    tier: "SHOP",
    separationCredits: 150,
    maxScreens: null,
    savedJobs: null,
    premiumExports: true,
    advancedOptimization: true,
    shopPresets: true,
    batchJobs: true,
  },
  PRO: {
    tier: "PRO",
    separationCredits: null,
    maxScreens: null,
    savedJobs: null,
    premiumExports: true,
    advancedOptimization: true,
    shopPresets: true,
    batchJobs: true,
  },
};

/**
 * Whether entitlements actually restrict anything.
 *
 * Hard off. The shop test must be frictionless, and a half-built paywall is
 * worse than none. Flipping this on is a deliberate future step.
 */
export const ENFORCE_ENTITLEMENTS = false;

export function defaultAccount(): AccountState {
  return {
    entitlements: TIER_ENTITLEMENTS.FREE,
    separationsCompleted: 0,
    firstSeenAt: new Date().toISOString(),
  };
}

export function loadAccount(): AccountState {
  const raw = readJson<AccountState | null>(STORAGE_KEYS.account, null);
  if (!raw || typeof raw !== "object" || typeof raw.separationsCompleted !== "number") {
    return defaultAccount();
  }
  const tier = raw.entitlements?.tier;
  return {
    entitlements: TIER_ENTITLEMENTS[tier] ?? TIER_ENTITLEMENTS.FREE,
    separationsCompleted: Math.max(0, Math.floor(raw.separationsCompleted)),
    firstSeenAt: typeof raw.firstSeenAt === "string" ? raw.firstSeenAt : new Date().toISOString(),
  };
}

export function saveAccount(state: AccountState): boolean {
  return writeJson(STORAGE_KEYS.account, state);
}

export function recordSeparation(state: AccountState): AccountState {
  return { ...state, separationsCompleted: state.separationsCompleted + 1 };
}

export function setTier(state: AccountState, tier: PlanTier): AccountState {
  return { ...state, entitlements: TIER_ENTITLEMENTS[tier] };
}

/** Credits left, or null when unmetered. Advisory only while enforcement is off. */
export function remainingCredits(state: AccountState): number | null {
  const total = state.entitlements.separationCredits;
  if (total === null) return null;
  return Math.max(0, total - state.separationsCompleted);
}

/** Always true while ENFORCE_ENTITLEMENTS is false. */
export function canSeparate(state: AccountState): boolean {
  if (!ENFORCE_ENTITLEMENTS) return true;
  const left = remainingCredits(state);
  return left === null || left > 0;
}
