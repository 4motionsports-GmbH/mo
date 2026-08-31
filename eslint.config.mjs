import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Hydration safety in the back-office: /admin is server-rendered in UTC and
  // hydrated in the operator's timezone, so a timezone-naive toLocale*String on
  // a Date produces two different strings and React throws a hydration mismatch
  // ("Minified React error #418"). Format through src/lib/admin-datetime.mjs,
  // which pins Europe/Berlin — see the header there for the full explanation.
  {
    files: ["src/app/admin/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^toLocale(Date|Time)String$/]",
          message:
            "Timezone-naive date formatting breaks hydration on /admin (React #418). " +
            "Use formatAdmin(value, ADMIN_*) from @/lib/admin-datetime.mjs instead.",
        },
        {
          // `toLocaleString` on a NUMBER is fine (and common) — only flag it
          // when it is called straight on a Date, which is the timezone-naive
          // shape that broke the Kampagne send-history column.
          selector:
            "MemberExpression[object.type='NewExpression'][object.callee.name='Date'][property.name='toLocaleString']",
          message:
            "Timezone-naive date formatting breaks hydration on /admin (React #418). " +
            "Use formatAdmin(value, ADMIN_*) from @/lib/admin-datetime.mjs instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
