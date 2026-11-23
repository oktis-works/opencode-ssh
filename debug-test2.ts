import { generateKeyPairSync } from "crypto"
import { mkdtempSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Server, utils, Client } from "ssh2"
import { SshConnection } from "./src/ssh/connection.js"

const { privateKey: hostPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const hostKeyPem = hostPriv.export({ type: "pkcs1", format: "pem" }).toString()

const { privateKey: userPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const userKeyPem = userPriv.export({ type: "pkcs1", format: "pem" }).toString()
const userPubBlob = (utils.parseKey(userKeyPem) as { getPublicSSH(): Buffer }).getPublicSSH()

const keyFile = (() => {
  const dir = mkdtempSync(join(tmpdir(), "it-key-"))
  const f = join(dir, "id_rsa")
  writeFileSync(f, userKeyPem)
  return f
})()

async function startServer() {
  return new Promise<any>((resolve, reject) => {
    const server = new Server({ hostKeys: [hostKeyPem] }, (client) => {
      client.on("authentication", (ctx) => {
        if (ctx.method === "password" && ctx.username === "testuser" && ctx.password === "secret") {
          ctx.accept()
        } else if (ctx.method === "publickey" && ctx.key.algo === "ssh-rsa" && ctx.key.data.equals(userPubBlob)) {
          ctx.accept()
        } else {
          ctx.reject(["password", "publickey"])
        }
      }).on("ready", () => {
        client.on("session", (accept) => {
          const session = accept()
          session.on("exec", (execAccept, _reject, info) => {
            const stream = execAccept()
            if (info.command === "whoami") {
              stream.write("testuser\n")
              stream.exit(0)
            } else {
              stream.exit(127)
            }
            stream.end()
          })
        })
      })
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port, close: () => new Promise(r => server.close(() => r())) })
    })
  })
}

// First, capture the real server key
async function getRealKey(port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const probe = new Client()
    probe.on("ready", () => { probe.end() })
    .on("error", reject)
    .connect({
      host: "127.0.0.1",
      port: port,
      username: "testuser",
      password: "secret",
      hostVerifier: (key: Buffer) => {
        resolve(key)
        return true
      }
    })
  })
}

async function main() {
  const server = await startServer()
  console.log("Server started on port", server.port)
  
  // Get the real server key
  const realKey = await getRealKey(server.port)
  console.log("Real key captured, length:", realKey.length)
  
  // Create known_hosts with the REAL key (should work)
  const dir = mkdtempSync(join(tmpdir(), "it-kh-"))
  const kh = join(dir, "known_hosts")
  writeFileSync(kh, `127.0.0.1 ssh-rsa ${realKey.toString("base64")}\n`)
  console.log("Known hosts written with REAL key")
  
  const good = new SshConnection("test-good", {
    host: "127.0.0.1",
    port: server.port,
    username: "testuser",
    authMethod: "password",
    password: "secret",
    strictHostKey: true,
    knownHostsPath: kh,
    autoReconnect: false,
    timeout: 5000,
  })
  
  try {
    console.log("Attempting connect with REAL key...")
    await good.connect()
    console.log("Connected successfully!")
    good.disconnect()
  } catch (e) {
    console.log("Failed with REAL key:", e.message)
  }
  
  await server.close()
}

main()
