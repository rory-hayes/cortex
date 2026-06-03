export default {
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/schema.ts",
  strict: true,
  verbose: true,
} as const;
