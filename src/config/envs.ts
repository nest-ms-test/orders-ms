import 'dotenv/config';
import * as Joi from 'joi';

interface EnvVars {
  PORT: number;
  NATS_SERVER_URL: string;
  DATABASE_URL: string;
}

const envVarsSchema: Joi.ObjectSchema = Joi.object({
  PORT: Joi.number().required(),
  NATS_SERVER_URL: Joi.string().required(),
  DATABASE_URL: Joi.string().required(),
}).unknown(true);

const { error, value } = envVarsSchema.validate(process.env, {
  abortEarly: false,
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const envVars: EnvVars = value;

export const envs = {
  PORT: envVars.PORT,
  NATS_SERVER_URL: envVars.NATS_SERVER_URL,
  DATABASE_URL: envVars.DATABASE_URL,
};
