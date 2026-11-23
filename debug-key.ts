import { generateKeyPairSync } from "crypto"
import { Server, utils, Client } from "ssh2"

const { privateKey: hostPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const hostKeyPem = hostPriv.export({ type: "pkcs1", format: "pem" }).toString()

const { privateKey: attackerPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const attackerKeyPem = attackerPriv.export({ type: "pkcs1", format: "pem" }).toString()
const attackerPubBlob = (utils.parseKey(attackerKeyPem) as { getPublicSSH(): Buffer }).getPublicSSH()

console.log("Attacker pub blob length:", attackerPubBlob.length)
console.log("Attacker pub blob (first 50 bytes):", attackerPubBlob.subarray(0, 50).toString('hex'))

// Now get the actual server key by connecting
async function getServerKey() {
  return new Promise<Buffer>((resolve, reject) => {
    const server = new Server({ hostKeys: [hostKeyPem] }, (client) => {
      client.on("authentication", (ctx) => ctx.reject())
      .on("ready", () => {})
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      const probe = new Client()
      probe.on("ready", () => { probe.end() })
      .on("error", reject)
      .connect({
        host: "127.0.0.1",
        port: addr.port,
        username: "test",
        password: "test",
        hostVerifier: (key: Buffer) => {
          console.log("Server key length:", key.length)
          console.log("Server key (first 50 bytes):", key.subarray(0, 50).toString('hex'))
          resolve(key)
          server.close()
        }
      })
    })
  })
}

getServerKey().then(() => console.log("Done"))
