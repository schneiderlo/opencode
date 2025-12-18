import { Storage } from "../storage/storage"

export namespace SimplePerf {
  export async function test() {
    await Storage.write(["test", "key"], { data: "test" })
  }
}
