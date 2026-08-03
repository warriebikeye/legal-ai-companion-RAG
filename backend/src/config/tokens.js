// src/config/tokens.js

export const COSTS = {
  question:             4,
  review:              30,
  referral_connection: 20,
};

export const BUNDLES = [
  {
    id:       "starter",
    tokens:   75,
    label:    "Starter",
    usdEquiv: 1.00,
    localAmounts: {
      NGN: 1500,
      KES: 200,
      GHS: 20,
      ZAR: 25,
    },
  },
  {
    id:       "standard",
    tokens:   170,
    label:    "Standard",
    usdEquiv: 2.50,
    localAmounts: {
      NGN: 3500,
      KES: 450,
      GHS: 45,
      ZAR: 55,
    },
  },
  {
    id:       "pro",
    tokens:   400,
    label:    "Pro",
    usdEquiv: 5.00,
    localAmounts: {
      NGN: 8000,
      KES: 1000,
      GHS: 100,
      ZAR: 130,
    },
  },
  {
    id:       "power",
    tokens:   900,
    label:    "Power",
    usdEquiv: 12.00,
    localAmounts: {
      NGN: 18000,
      KES: 2300,
      GHS: 230,
      ZAR: 300,
    },
  },
];

export const FREE_DAILY_TOKENS   = 4;
export const REFERRAL_REWARD     = 75;
export const TOKEN_EXPIRY_DAYS   = 90;
export const EXPIRY_WARNING_DAYS = 14;