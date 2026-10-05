import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Node-only packages stay out of the webpack bundle (native bindings, raw http, job queue).
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "@node-rs/argon2",
    "@amplitude/analytics-node",
    "nodemailer",
    "pdfkit",
  ],
};
export default config;
