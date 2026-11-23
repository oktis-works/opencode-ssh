import { SshConnection } from "./src/ssh/connection.js"
import { generateKeyPairSync } from "crypto"
import { mkdtempSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Server, utils } from "ssh2"

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
        if (ctx.method === "publickey" && ctx.key.algo === "ssh-rsa" && ctx.key.data.equals(userPubBlob)) {
          ctx.accept()
        } else {
          ctx.reject(["publickey"])
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
  
  const conn = new SshConnection("test", {
    host: "127.0.0.1",
    port: server.port,
    username: "testuser",
    authMethod: "key",
    keyPath: keyFile,
    timeout: 5000,
  })
  
  try {
    await conn.connect()
    console.log("Connected:", conn.connected)
    
    conn.disconnect()
    console.log("After disconnect:", conn.connected)
    
    // Try reconnect
    const result = await conn.exec("whoami")
    console.log("Reconnect result:", result)
  } catch (e) {
    console.error("Error:", e)
  }
  
  await server.close()
}

main()
