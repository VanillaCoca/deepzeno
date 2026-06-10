"use client";

import {
  CircleHelpIcon,
  Loader2Icon,
  PaperclipIcon,
  PencilIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  type ConfirmExtractionPayload,
  confirmExtraction,
  createBlankProject,
} from "@/lib/actions/project-creation";
import { humanLabel, IR_TYPE_COPY } from "@/lib/ir-types";
import type {
  ExtractedDecision,
  ExtractionResult,
} from "@/lib/types/extraction";
import { generateUUID } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

type ModalStage = "input" | "extracting" | "review";

type ReviewDecision = ExtractedDecision & {
  id: string;
  checked: boolean;
};

type ReviewTopic = {
  id: string;
  name: string;
  decisions: ReviewDecision[];
};

type ReviewState = {
  projectName: string;
  topics: ReviewTopic[];
};

type CreateProjectState = {
  stage: ModalStage;
  input: string;
  error: string | null;
  review: ReviewState | null;
};

type CreateProjectAction =
  | { type: "set_input"; value: string }
  | { type: "start_extracting" }
  | { type: "extract_success"; result: ExtractionResult; title: string }
  | { type: "extract_error"; message: string }
  | { type: "back_to_input" }
  | { type: "rename_project"; value: string }
  | { type: "rename_topic"; topicId: string; value: string }
  | {
      type: "toggle_decision";
      topicId: string;
      decisionId: string;
      checked: boolean;
    }
  | { type: "reset" };

const initialState: CreateProjectState = {
  stage: "input",
  input: "",
  error: null,
  review: null,
};

function createReviewState(
  result: ExtractionResult,
  titleOverride?: string
): ReviewState {
  return {
    // The user-entered title is authoritative (it's now required); fall back to
    // the model's suggestion only if somehow empty.
    projectName:
      titleOverride?.trim() || result.projectName.trim() || "Untitled project",
    topics: result.topics.map((topic) => ({
      id: generateUUID(),
      name: topic.name,
      decisions: topic.decisions.map((decision) => ({
        ...decision,
        id: generateUUID(),
        checked: true,
      })),
    })),
  };
}

function reducer(
  state: CreateProjectState,
  action: CreateProjectAction
): CreateProjectState {
  switch (action.type) {
    case "set_input":
      return {
        ...state,
        input: action.value,
        error: null,
      };
    case "start_extracting":
      return {
        ...state,
        stage: "extracting",
        error: null,
      };
    case "extract_success":
      return {
        ...state,
        stage: "review",
        error: null,
        review: createReviewState(action.result, action.title),
      };
    case "extract_error":
      return {
        ...state,
        stage: "input",
        error: action.message,
      };
    case "back_to_input":
      return {
        ...state,
        stage: "input",
        error: null,
      };
    case "rename_project":
      if (!state.review) {
        return state;
      }

      return {
        ...state,
        review: {
          ...state.review,
          projectName: action.value,
        },
      };
    case "rename_topic":
      if (!state.review) {
        return state;
      }

      return {
        ...state,
        review: {
          ...state.review,
          topics: state.review.topics.map((topic) =>
            topic.id === action.topicId
              ? {
                  ...topic,
                  name: action.value,
                }
              : topic
          ),
        },
      };
    case "toggle_decision":
      if (!state.review) {
        return state;
      }

      return {
        ...state,
        review: {
          ...state.review,
          topics: state.review.topics.map((topic) =>
            topic.id === action.topicId
              ? {
                  ...topic,
                  decisions: topic.decisions.map((decision) =>
                    decision.id === action.decisionId
                      ? {
                          ...decision,
                          checked: action.checked,
                        }
                      : decision
                  ),
                }
              : topic
          ),
        },
      };
    case "reset":
      return initialState;
    default:
      return state;
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function CreateProjectModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isMutating, startMutation] = useTransition();
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [topicNameDraft, setTopicNameDraft] = useState("");
  // Required project title — every start path (blank or extract) needs it.
  const [projectTitle, setProjectTitle] = useState("");
  const hasTitle = projectTitle.trim().length > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractAbortControllerRef = useRef<AbortController | null>(null);
  const review = state.review;

  const totalDecisionCount = useMemo(
    () =>
      review?.topics.reduce(
        (count, topic) => count + topic.decisions.length,
        0
      ) ?? 0,
    [review]
  );
  const checkedCount = useMemo(
    () =>
      review?.topics.reduce(
        (count, topic) =>
          count + topic.decisions.filter((decision) => decision.checked).length,
        0
      ) ?? 0,
    [review]
  );
  const nonEmptyTopicCount = useMemo(
    () =>
      review?.topics.filter((topic) =>
        topic.decisions.some((decision) => decision.checked)
      ).length ?? 0,
    [review]
  );

  useEffect(() => {
    return () => {
      extractAbortControllerRef.current?.abort();
    };
  }, []);

  function resetModalState() {
    extractAbortControllerRef.current?.abort();
    extractAbortControllerRef.current = null;
    setEditingProjectName(false);
    setEditingTopicId(null);
    setProjectNameDraft("");
    setTopicNameDraft("");
    setProjectTitle("");
    dispatch({ type: "reset" });
  }

  function requestClose() {
    if (isMutating) {
      return;
    }

    resetModalState();
    setOpen(false);
  }

  async function handleExtract() {
    if (state.input.trim().length === 0 || !hasTitle) {
      return;
    }

    const controller = new AbortController();
    extractAbortControllerRef.current?.abort();
    extractAbortControllerRef.current = controller;
    dispatch({ type: "start_extracting" });

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: state.input,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Couldn't extract — try again or start blank.");
      }

      const result = (await response.json()) as ExtractionResult;
      dispatch({ type: "extract_success", result, title: projectTitle });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      console.error("Extraction failed", error);
      dispatch({
        type: "extract_error",
        message: t("dialog.createProject.extractFailed"),
      });
    } finally {
      if (extractAbortControllerRef.current === controller) {
        extractAbortControllerRef.current = null;
      }
    }
  }

  function beginProjectNameEdit() {
    if (!review) {
      return;
    }

    setProjectNameDraft(review.projectName);
    setEditingProjectName(true);
  }

  function commitProjectName() {
    if (!review) {
      setEditingProjectName(false);
      return;
    }

    const trimmed = projectNameDraft.trim();

    if (trimmed.length > 0) {
      dispatch({
        type: "rename_project",
        value: trimmed,
      });
    }

    setProjectNameDraft("");
    setEditingProjectName(false);
  }

  function beginTopicNameEdit(topic: ReviewTopic) {
    setTopicNameDraft(topic.name);
    setEditingTopicId(topic.id);
  }

  function commitTopicName(topic: ReviewTopic) {
    const trimmed = topicNameDraft.trim();

    if (trimmed.length > 0) {
      dispatch({
        type: "rename_topic",
        topicId: topic.id,
        value: trimmed,
      });
    }

    setTopicNameDraft("");
    setEditingTopicId(null);
  }

  function buildConfirmPayload(): ConfirmExtractionPayload | null {
    if (!review) {
      return null;
    }

    const topics = review.topics
      .map((topic) => ({
        name: topic.name.trim(),
        decisions: topic.decisions
          .filter((decision) => decision.checked)
          .map((decision) => ({
            type: decision.type,
            content: decision.content.trim(),
          }))
          .filter((decision) => decision.content.length > 0),
      }))
      .filter((topic) => topic.decisions.length > 0);

    if (topics.length === 0) {
      return null;
    }

    return {
      projectName: review.projectName.trim() || "Untitled project",
      topics,
    };
  }

  function handleStartBlank() {
    if (!hasTitle) {
      return;
    }
    startMutation(async () => {
      try {
        const { projectId, topicId } = await createBlankProject(projectTitle);
        resetModalState();
        setOpen(false);
        router.push(`/chat/new?projectId=${projectId}&topicId=${topicId}`);
        router.refresh();
      } catch (error) {
        console.error("Create blank project failed", error);
        toast.error(
          getErrorMessage(error, t("dialog.createProject.somethingWentWrong"))
        );
      }
    });
  }

  function handleConfirm() {
    const payload = buildConfirmPayload();

    if (!payload) {
      toast.error(t("dialog.createProject.selectAtLeastOneToast"));
      return;
    }

    startMutation(async () => {
      try {
        const { projectId, topicId } = await confirmExtraction(payload);
        resetModalState();
        setOpen(false);
        router.push(`/chat/new?projectId=${projectId}&topicId=${topicId}`);
        router.refresh();
      } catch (error) {
        console.error("Confirm extraction failed", error);
        toast.error(
          getErrorMessage(error, t("dialog.createProject.somethingWentWrong"))
        );
      }
    });
  }

  const extractionEmpty = state.stage === "review" && totalDecisionCount === 0;
  const dialogWidthClass =
    state.stage === "review" ? "sm:max-w-3xl" : "sm:max-w-xl";

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }

        requestClose();
      }}
      open={open}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className={`max-h-[85dvh] overflow-hidden rounded-3xl ${dialogWidthClass}`}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        {state.stage === "input" && (
          <div className="flex max-h-[calc(85dvh-3rem)] flex-col gap-5">
            <DialogHeader className="shrink-0 space-y-2">
              <DialogTitle className="text-lg font-medium">
                {t("dialog.createProject.inputTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("dialog.createProject.inputDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 space-y-3">
              {state.error ? (
                <p className="text-sm text-destructive">{state.error}</p>
              ) : null}
              <div className="space-y-1.5">
                <label
                  className="font-medium text-foreground text-sm"
                  htmlFor="create-project-title"
                >
                  {t("dialog.createProject.titleLabel")}
                </label>
                <Input
                  autoFocus
                  id="create-project-title"
                  onChange={(event) => setProjectTitle(event.target.value)}
                  placeholder={t("dialog.createProject.titlePlaceholder")}
                  value={projectTitle}
                />
              </div>
              <Textarea
                className="min-h-32 max-h-[40dvh] resize-none overflow-y-auto sm:max-h-[320px]"
                onChange={(event) =>
                  dispatch({
                    type: "set_input",
                    value: event.target.value,
                  })
                }
                placeholder={t("dialog.createProject.inputPlaceholder")}
                rows={6}
                value={state.input}
              />
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <input className="hidden" ref={fileInputRef} type="file" />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PaperclipIcon className="size-3.5" />
                  {t("dialog.createProject.attachFiles")}
                </Button>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  aria-busy={isMutating}
                  disabled={isMutating || !hasTitle}
                  onClick={handleStartBlank}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {isMutating ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : null}
                  {isMutating
                    ? t("dialog.createProject.creatingWorkspace")
                    : t("dialog.createProject.startBlank")}
                </Button>
                <Button
                  className="bg-foreground text-background hover:bg-foreground/90"
                  disabled={state.input.trim().length === 0 || !hasTitle}
                  onClick={() => {
                    handleExtract().catch(console.error);
                  }}
                  size="sm"
                  type="button"
                >
                  {t("dialog.createProject.extract")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {state.stage === "extracting" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("dialog.createProject.extracting")}
            </p>
          </div>
        )}

        {state.stage === "review" && review && (
          <div className="flex max-h-[calc(85dvh-3rem)] flex-col">
            <div className="overflow-y-auto pr-1">
              {extractionEmpty ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <p className="text-center text-sm text-muted-foreground">
                    {t("dialog.createProject.emptyExtraction")}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => dispatch({ type: "back_to_input" })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("dialog.createProject.back")}
                    </Button>
                    <Button
                      aria-busy={isMutating}
                      disabled={isMutating}
                      onClick={handleStartBlank}
                      size="sm"
                      type="button"
                    >
                      {isMutating ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : null}
                      {isMutating
                        ? t("dialog.createProject.creatingWorkspace")
                        : t("dialog.createProject.startBlankArrow")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    {editingProjectName ? (
                      <Input
                        autoFocus
                        className="h-10 rounded-xl text-base font-medium"
                        onBlur={commitProjectName}
                        onChange={(event) =>
                          setProjectNameDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitProjectName();
                          }
                        }}
                        value={projectNameDraft}
                      />
                    ) : (
                      <button
                        className="flex items-center text-left"
                        onClick={beginProjectNameEdit}
                        type="button"
                      >
                        <span className="text-lg font-medium text-foreground">
                          {review.projectName}
                        </span>
                        <PencilIcon className="ml-2 h-3.5 w-3.5 text-muted-foreground/70" />
                      </button>
                    )}

                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("dialog.createProject.groupedPrefix", {
                        count: totalDecisionCount,
                      })}
                      <span className="font-medium text-foreground">
                        {review.topics.length}{" "}
                        {review.topics.length === 1
                          ? t("dialog.createProject.topicSingular")
                          : t("dialog.createProject.topicPlural")}
                      </span>
                      {t("dialog.createProject.groupedSuffix")}
                    </p>
                  </div>

                  <TooltipProvider delayDuration={200} skipDelayDuration={500}>
                    <div className="mt-5 space-y-3">
                      {review.topics.map((topic) => (
                        <div
                          className="space-y-1 rounded-md border border-border p-3"
                          key={topic.id}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="select-none text-sm text-muted-foreground/70">
                                #
                              </span>
                              {editingTopicId === topic.id ? (
                                <Input
                                  autoFocus
                                  className="h-8 rounded-lg text-sm font-medium"
                                  onBlur={() => commitTopicName(topic)}
                                  onChange={(event) =>
                                    setTopicNameDraft(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      commitTopicName(topic);
                                    }
                                  }}
                                  value={topicNameDraft}
                                />
                              ) : (
                                <button
                                  className="truncate text-left text-sm font-medium text-foreground"
                                  onClick={() => beginTopicNameEdit(topic)}
                                  type="button"
                                >
                                  {topic.name}
                                </button>
                              )}
                            </div>

                            {editingTopicId === topic.id ? null : (
                              <button
                                className="text-muted-foreground/70 transition-colors hover:text-foreground"
                                onClick={() => beginTopicNameEdit(topic)}
                                type="button"
                              >
                                <PencilIcon className="h-3 w-3" />
                                <span className="sr-only">
                                  {t("dialog.createProject.renameTopic")}
                                </span>
                              </button>
                            )}
                          </div>

                          {topic.decisions.map((decision) => (
                            <label
                              className="group flex cursor-pointer items-start gap-2 py-1.5"
                              key={decision.id}
                            >
                              <input
                                checked={decision.checked}
                                className="mt-0.5 h-4 w-4 rounded border border-border bg-background accent-foreground"
                                onChange={(event) =>
                                  dispatch({
                                    type: "toggle_decision",
                                    topicId: topic.id,
                                    decisionId: decision.id,
                                    checked: event.target.checked,
                                  })
                                }
                                type="checkbox"
                              />

                              <div className="flex flex-wrap items-baseline gap-1 text-sm leading-relaxed">
                                <span className="whitespace-nowrap text-muted-foreground">
                                  {humanLabel(decision.type)}
                                </span>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      aria-label={t(
                                        "dialog.createProject.whatIsType",
                                        { type: humanLabel(decision.type) }
                                      )}
                                      className="inline-flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
                                      onClick={(event) =>
                                        event.preventDefault()
                                      }
                                      onPointerDown={(event) =>
                                        event.preventDefault()
                                      }
                                      type="button"
                                    >
                                      <CircleHelpIcon className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    align="start"
                                    className="max-w-[300px] p-3"
                                    side="top"
                                    sideOffset={6}
                                  >
                                    <div>
                                      <p className="text-sm text-background">
                                        {IR_TYPE_COPY[decision.type].definition}
                                      </p>
                                      <p className="mt-1.5 text-sm italic text-background/80">
                                        e.g.{" "}
                                        {IR_TYPE_COPY[decision.type].example}
                                      </p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>

                                <span className="mx-0.5 text-muted-foreground">
                                  ·
                                </span>
                                <span className="text-foreground">
                                  {decision.content}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </TooltipProvider>
                </>
              )}
            </div>

            {extractionEmpty ? null : (
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <Button
                  disabled={isMutating}
                  onClick={() => dispatch({ type: "back_to_input" })}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("dialog.createProject.back")}
                </Button>

                <Button
                  aria-busy={isMutating}
                  className="bg-foreground text-background hover:bg-foreground/90"
                  disabled={checkedCount === 0 || isMutating}
                  onClick={handleConfirm}
                  size="sm"
                  type="button"
                >
                  {isMutating ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : null}
                  {isMutating
                    ? t("dialog.createProject.creatingWorkspace")
                    : checkedCount === 0
                      ? t("dialog.createProject.selectAtLeastOneButton")
                      : t("dialog.createProject.confirmSummary", {
                          checked: checkedCount,
                          topics: nonEmptyTopicCount,
                        })}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
