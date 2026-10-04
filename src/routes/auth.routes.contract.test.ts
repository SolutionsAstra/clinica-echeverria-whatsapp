// tests/auth.routes.contract.test.ts
// Costura bajo prueba: HTTP POST /api/auth/login, montado igual que en src/server.js.
// Objetivo: demostrar que el backend NUNCA responde 404 en la ruta correcta y fijar
// el contrato { ok, usuario } | { error } que consume el fetch del frontend.
//
// Requiere: npm i -D jest ts-jest supertest @types/supertest @types/jest

import express from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";

// Prefijo "mock" obligatorio para que jest.mock (hoisted) pueda referenciarlo.
const mockQuery = jest.fn();
jest.mock("../src/db", () => ({ getPool: async () => ({ query: mockQuery }) }));

import { authRouter } from "../routes/auth.routes";

const EMAIL = "recepcion@clinicaecheverria.com";
const PASSWORD = "recepcion123";

function crearApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  app.use("/api/auth", authRouter); // idéntico a server.js
  return app;
}

beforeAll(() => {
  const hash = bcrypt.hashSync(PASSWORD, 4); // costo bajo solo para velocidad del test
  mockQuery.mockImplementation(async (_sql: string, [email]: [string]) => ({
    rows:
      email === EMAIL
        ? [{ id: 1, nombre: "Recepción", email: EMAIL, password_hash: hash, rol: "recepcion", doctor_id: null, activo: true }]
        : [],
  }));
});

describe("POST /api/auth/login — contrato con el frontend", () => {
  it("credenciales de prueba → 200 { ok: true, usuario } y cookie de sesión", async () => {
    const res = await request(crearApp()).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      usuario: { id: 1, nombre: "Recepción", email: EMAIL, rol: "recepcion", doctor_id: null },
    });
    expect(res.body.usuario).not.toHaveProperty("password_hash");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^connect\.sid=/);
  });

  it("email con mayúsculas y espacios se normaliza", async () => {
    const res = await request(crearApp()).post("/api/auth/login").send({ email: "  RECEPCION@ClinicaEcheverria.com ", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("clave incorrecta → 401 { error } (nunca 404)", async () => {
    const res = await request(crearApp()).post("/api/auth/login").send({ email: EMAIL, password: "mala" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Correo o contraseña incorrectos" });
  });

  it("body vacío → 400 { error }", async () => {
    const res = await request(crearApp()).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("la ruta NO está duplicada: /api/auth/api/auth/login no existe", async () => {
    const res = await request(crearApp()).post("/api/auth/api/auth/login").send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(404);
  });

  it("concurrencia: 25 logins simultáneos → todos 200 con sesiones distintas", async () => {
    const app = crearApp();
    const respuestas = await Promise.all(
      Array.from({ length: 25 }, () => request(app).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD })),
    );
    expect(respuestas.every((r) => r.status === 200)).toBe(true);
    const sids = new Set(respuestas.map((r) => r.headers["set-cookie"][0].split(";")[0]));
    expect(sids.size).toBe(25);
  });

  it("GET /api/auth/me con la cookie recién emitida devuelve el usuario", async () => {
    const agente = request.agent(crearApp());
    await agente.post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200);
    const me = await agente.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(EMAIL);
  });
});
