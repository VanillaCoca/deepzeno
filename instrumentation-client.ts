import { initBotId } from "botid/client/core";

if (process.env.NODE_ENV === "production") {
  initBotId({
    protect: [
      {
        path: "/api/chat",
        method: "POST",
      },
    ],
  });
}
