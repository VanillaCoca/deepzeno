import "server-only";

import { saveChat, saveMessages } from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { getServerLocale } from "@/lib/i18n/server";
import { logIREvent } from "@/lib/ir/queries";
import { generateUUID } from "@/lib/utils";
import { saveWorkspaceMessages } from "@/lib/workspace/queries";

// Consultant-style intake (spec: research-engine L1). Static template, not a
// model call: deterministic, instant, free, and translatable. The user answers
// free-form; the kickoff synthesis run reads the whole exchange.
const INTAKE_TEMPLATES: Record<"en" | "zh" | "fr", string> = {
  en: [
    "Welcome — before this project goes anywhere, help me understand it. Answer in your own words, as much or as little as you like:",
    "",
    "1. What outcome would make this project a success?",
    "2. What hard constraints exist (budget, deadline, people, tech)?",
    "3. What have you already decided — things that are settled, not up for debate?",
    "4. What are you most uncertain about right now?",
    "5. Who or what outside your control could change the picture?",
    "",
    "When you’re done, press “Propose topics” above and I’ll draft a topic breakdown with the open questions, constraints, and goals I heard — every item lands as a candidate for you to confirm. Or skip and start blank.",
  ].join("\n"),
  zh: [
    "欢迎 — 在项目开始之前，先帮我理解它。用你自己的话回答，长短随意：",
    "",
    "1. 什么样的结果算这个项目成功？",
    "2. 有哪些硬约束（预算、期限、人手、技术）？",
    "3. 哪些事情已经定了 — 不再讨论的部分？",
    "4. 你现在最不确定的是什么？",
    "5. 有哪些你控制不了的外部因素可能改变局面？",
    "",
    "答完后点上方的“生成主题提案”，我会起草一份主题拆解，把听到的待决问题、约束和目标整理出来 — 每一项都以候选形式出现，由你确认。也可以跳过，从空白开始。",
  ].join("\n"),
  fr: [
    "Bienvenue — avant d'aller plus loin, aidez-moi à comprendre ce projet. Répondez avec vos propres mots, longuement ou non :",
    "",
    "1. Quel résultat ferait de ce projet un succès ?",
    "2. Quelles contraintes dures existent (budget, délai, équipe, technique) ?",
    "3. Qu'avez-vous déjà décidé — ce qui est acté, non négociable ?",
    "4. De quoi êtes-vous le plus incertain en ce moment ?",
    "5. Qui ou quoi, hors de votre contrôle, pourrait changer la donne ?",
    "",
    "Quand vous avez terminé, cliquez sur « Proposer des sujets » ci-dessus et je rédigerai un découpage en sujets avec les questions ouvertes, contraintes et objectifs entendus — chaque élément arrive comme candidat à confirmer. Ou passez et démarrez à blanc.",
  ].join("\n"),
};

export async function seedKickoffIntake({
  userId,
  projectId,
  topicId,
  conversationId,
  projectName,
}: {
  userId: string;
  projectId: string;
  topicId: string;
  conversationId: string;
  projectName: string;
}) {
  const locale = await getServerLocale();
  const content = INTAKE_TEMPLATES[locale] ?? INTAKE_TEMPLATES.en;
  const messageId = generateUUID();
  const now = new Date();

  // The chat UI loads Message_v2 rows by chatId === workspace conversation id;
  // Message_v2.chatId has an FK to Chat, so the Chat row must exist first. The
  // chat route tolerates a pre-existing Chat row (it loads history instead of
  // re-creating, app/(chat)/api/chat/route.ts:215-251).
  await saveChat({
    id: conversationId,
    userId,
    title: projectName,
    visibility: "private",
  });
  await saveMessages({
    messages: [
      {
        id: messageId,
        chatId: conversationId,
        role: "assistant",
        parts: [{ type: "text", text: content }] as DBMessage["parts"],
        attachments: [] as DBMessage["attachments"],
        createdAt: now,
      },
    ],
  });
  await saveWorkspaceMessages([
    {
      id: messageId,
      conversationId,
      topicId,
      projectId,
      role: "assistant",
      content,
      createdAt: now.toISOString(),
    },
  ]);
  await logIREvent({
    projectId,
    topicId,
    event: "kickoff_intake_seeded",
    layer: "kickoff",
    metadata: { conversationId, locale },
  });
}
