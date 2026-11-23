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

const { privateKey: attackerPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const attackerKeyPem = attackerPriv.export({ type: "pkcs1", format: "pem" }).toString()
const attackerPubBlob = (utils.parseKey(attackerKeyPem) as { getPublicSSH(): Buffer }).getPublicSSH()

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

async function main() {
  const server = await startServer()
  console.log("Server started on port", server.port)
  
  // Create known_hosts with ATTACKER key
  const dir = mkdtempSync(join(tmpdir(), "it-kh-"))
  const kh = join(dir, "known_hosts")
  writeFileSync(kh, `127.0.0.1 ssh-rsa ${attackerPubBlob.toString("base64")}\n`)
  console.log("Known hosts written with ATTACKER key")
  
  const bad = new SshConnection("test-bad", {
    host: "127.0.0.1",
    port: server.port,
    username: "testuser",
    authMethod: "password",
    password: "secret",
    strictHostKey: true,
    knownHostsPath: kh,
    autoReconnect: false,
    timeout: 2000,  // 2 second timeout
  })
  
  try {
    console.log("Attempting connect with ATTACKER key (2s timeout)...")
    await bad.connect()
    console.log("Connected unexpectedly!")
  } catch (e) {
    console.log("Error:", e.message)
    console.log("Error code:", (e as any).code)
  }
  
  await server.close()
}

main()
