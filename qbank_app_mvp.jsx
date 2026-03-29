import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Upload, BookOpen, RotateCcw, CheckCircle2, XCircle, Image as ImageIcon, Database, Trash2 } from "lucide-react";

/**
 * QBank MVP
 * - Import one or more JSON banks
 * - Persist progress in localStorage
 * - Switch between banks
 * - Track answered / correct / incorrect / flagged / unseen
 * - Supports images by relative or absolute URL paths
 *
 * Expected JSON shapes supported:
 * 1) Array<Question>
 * 2) { name?: string, questions: Array<Question> }
 *
 * Question example:
 * {
 *   "id": "q1",
 *   "stem": "A 25-year-old...",
 *   "options": [
 *     { "id": "A", "text": "Choice A" },
 *     { "id": "B", "text": "Choice B" }
 *   ],
 *   "answer": "B",
 *   "explanation": "Because...",
 *   "system": "Cardio",
 *   "topic": "Murmurs",
 *   "image": "/images/cardio/q1.jpg"
 * }
 */

const STORAGE_KEY = "qbank-mvp-v1";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { banks: {}, activeBankId: null };
    return JSON.parse(raw);
  } catch {
    return { banks: {}, activeBankId: null };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeQuestion(q, index) {
  const options = Array.isArray(q.options)
    ? q.options.map((opt, i) => {
        if (typeof opt === "string") {
          const letter = String.fromCharCode(65 + i);
          return { id: letter, text: opt };
        }
        return {
          id: opt.id ?? String.fromCharCode(65 + i),
          text: opt.text ?? "",
        };
      })
    : [];

  return {
    id: q.id ?? `q_${index + 1}`,
    stem: q.stem ?? q.question ?? "",
    options,
    answer: q.answer ?? q.correctAnswer ?? q.correct ?? null,
    explanation: q.explanation ?? "",
    system: q.system ?? "General",
    topic: q.topic ?? "Misc",
    image: q.image ?? q.imageUrl ?? null,
  };
}

function normalizeBank(json, fallbackName = "Imported Bank") {
  let name = fallbackName;
  let questions = [];

  if (Array.isArray(json)) {
    questions = json;
  } else if (json && Array.isArray(json.questions)) {
    name = json.name || fallbackName;
    questions = json.questions;
  } else {
    throw new Error("Invalid JSON format. Use either an array of questions or an object with a questions array.");
  }

  const normalized = questions.map(normalizeQuestion);
  return {
    id: uid(),
    name,
    questions: normalized,
    progress: Object.fromEntries(
      normalized.map((q) => [
        q.id,
        {
          selected: null,
          answered: false,
          correct: null,
          flagged: false,
          seen: false,
          updatedAt: null,
        },
      ])
    ),
    createdAt: new Date().toISOString(),
  };
}

function mergeBank(existingBank, nextJson) {
  const incoming = normalizeBank(nextJson, existingBank.name);
  const nextQuestions = incoming.questions;
  const nextProgress = {};

  for (const q of nextQuestions) {
    nextProgress[q.id] = existingBank.progress[q.id] || {
      selected: null,
      answered: false,
      correct: null,
      flagged: false,
      seen: false,
      updatedAt: null,
    };
  }

  return {
    ...existingBank,
    questions: nextQuestions,
    progress: nextProgress,
    updatedAt: new Date().toISOString(),
  };
}

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function QuestionCard({ question, status, onAnswer, onToggleFlag, revealMode }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="secondary">{question.system}</Badge>
          <Badge variant="outline">{question.topic}</Badge>
          {status.flagged && <Badge className="rounded-full">Flagged</Badge>}
          {status.answered && (
            status.correct ? <Badge className="rounded-full">Correct</Badge> : <Badge variant="destructive">Incorrect</Badge>
          )}
        </div>
        <CardTitle className="text-lg leading-7">{question.stem}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {question.image && (
          <div className="rounded-2xl overflow-hidden border bg-slate-50">
            <img src={question.image} alt="Question visual" className="w-full h-auto object-contain max-h-[400px]" />
          </div>
        )}

        <div className="grid gap-3">
          {question.options.map((opt) => {
            const isSelected = status.selected === opt.id;
            const isCorrect = question.answer === opt.id;
            const showReveal = revealMode && status.answered;

            return (
              <button
                key={opt.id}
                onClick={() => onAnswer(opt.id)}
                disabled={status.answered}
                className={classNames(
                  "text-left rounded-2xl border p-4 transition-all",
                  isSelected ? "border-slate-900" : "border-slate-200 hover:border-slate-400",
                  showReveal && isCorrect && "ring-2 ring-offset-1",
                  showReveal && isSelected && !isCorrect && "border-red-500"
                )}
              >
                <div className="flex gap-3 items-start">
                  <div className="min-w-8 h-8 rounded-full border flex items-center justify-center text-sm font-semibold">
                    {opt.id}
                  </div>
                  <div className="flex-1 pt-1">{opt.text}</div>
                  {showReveal && isCorrect && <CheckCircle2 className="w-5 h-5" />}
                  {showReveal && isSelected && !isCorrect && <XCircle className="w-5 h-5" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={onToggleFlag} className="rounded-xl">
            {status.flagged ? "Unflag" : "Flag question"}
          </Button>
        </div>

        {status.answered && question.explanation && (
          <div className="rounded-2xl border p-4 bg-slate-50">
            <div className="font-semibold mb-2">Explanation</div>
            <p className="whitespace-pre-wrap text-sm leading-6">{question.explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function QBankApp() {
  const fileInputRef = useRef(null);
  const [state, setState] = useState(loadState);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [bankImportName, setBankImportName] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const bankIds = Object.keys(state.banks);
  const activeBank = state.activeBankId ? state.banks[state.activeBankId] : null;

  const stats = useMemo(() => {
    if (!activeBank) return null;
    const items = Object.values(activeBank.progress);
    const total = items.length;
    const answered = items.filter((p) => p.answered).length;
    const correct = items.filter((p) => p.correct === true).length;
    const incorrect = items.filter((p) => p.correct === false).length;
    const flagged = items.filter((p) => p.flagged).length;
    const unseen = items.filter((p) => !p.seen).length;
    return { total, answered, correct, incorrect, flagged, unseen };
  }, [activeBank]);

  const filteredQuestions = useMemo(() => {
    if (!activeBank) return [];

    return activeBank.questions.filter((q) => {
      const p = activeBank.progress[q.id];
      const haystack = `${q.stem} ${q.system} ${q.topic}`.toLowerCase();
      const searchMatch = haystack.includes(search.toLowerCase());
      if (!searchMatch) return false;

      switch (filter) {
        case "unseen":
          return !p.seen;
        case "unanswered":
          return !p.answered;
        case "correct":
          return p.correct === true;
        case "incorrect":
          return p.correct === false;
        case "flagged":
          return p.flagged;
        default:
          return true;
      }
    });
  }, [activeBank, search, filter]);

  const currentQuestion = filteredQuestions[currentIndex] || null;
  const currentStatus = currentQuestion && activeBank ? activeBank.progress[currentQuestion.id] : null;

  useEffect(() => {
    setCurrentIndex(0);
  }, [state.activeBankId, search, filter]);

  function updateState(updater) {
    setState((prev) => updater(prev));
  }

  function setActiveBank(bankId) {
    updateState((prev) => ({ ...prev, activeBankId: bankId }));
  }

  function importBankObject(jsonObj, fallbackName = "Imported Bank") {
    const bank = normalizeBank(jsonObj, fallbackName);
    updateState((prev) => ({
      banks: { ...prev.banks, [bank.id]: bank },
      activeBankId: bank.id,
    }));
    setRawJson("");
    setBankImportName("");
  }

  function replaceActiveBankWithJson(jsonObj) {
    if (!activeBank) return;
    const merged = mergeBank(activeBank, jsonObj);
    updateState((prev) => ({
      ...prev,
      banks: { ...prev.banks, [activeBank.id]: merged },
    }));
  }

  function onFileImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        importBankObject(parsed, bankImportName || file.name.replace(/\.json$/i, ""));
      } catch (err) {
        alert(err instanceof Error ? err.message : "Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function importFromTextarea() {
    try {
      const parsed = JSON.parse(rawJson);
      importBankObject(parsed, bankImportName || "Imported Bank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Invalid JSON.");
    }
  }

  function updateCurrentProgress(patch) {
    if (!activeBank || !currentQuestion) return;
    updateState((prev) => {
      const bank = prev.banks[prev.activeBankId];
      return {
        ...prev,
        banks: {
          ...prev.banks,
          [bank.id]: {
            ...bank,
            progress: {
              ...bank.progress,
              [currentQuestion.id]: {
                ...bank.progress[currentQuestion.id],
                ...patch,
                updatedAt: new Date().toISOString(),
              },
            },
          },
        },
      };
    });
  }

  function answerQuestion(optionId) {
    if (!currentQuestion || !currentStatus || currentStatus.answered) return;
    updateCurrentProgress({
      selected: optionId,
      answered: true,
      correct: currentQuestion.answer === optionId,
      seen: true,
    });
  }

  function toggleFlag() {
    if (!currentStatus) return;
    updateCurrentProgress({ flagged: !currentStatus.flagged, seen: true });
  }

  function markSeenIfNeeded() {
    if (!currentQuestion || !currentStatus || currentStatus.seen) return;
    updateCurrentProgress({ seen: true });
  }

  useEffect(() => {
    markSeenIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  function resetBankProgress() {
    if (!activeBank) return;
    const resetProgress = Object.fromEntries(
      activeBank.questions.map((q) => [
        q.id,
        { selected: null, answered: false, correct: null, flagged: false, seen: false, updatedAt: null },
      ])
    );

    updateState((prev) => ({
      ...prev,
      banks: {
        ...prev.banks,
        [activeBank.id]: {
          ...activeBank,
          progress: resetProgress,
        },
      },
    }));
    setCurrentIndex(0);
  }

  function deleteActiveBank() {
    if (!activeBank) return;
    updateState((prev) => {
      const copy = { ...prev.banks };
      delete copy[activeBank.id];
      const nextActive = Object.keys(copy)[0] || null;
      return { banks: copy, activeBankId: nextActive };
    });
  }

  function exportProgress() {
    if (!activeBank) return;
    const blob = new Blob([JSON.stringify(activeBank, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeBank.name.replace(/\s+/g, "_").toLowerCase()}_progress.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importReplacementJson() {
    try {
      const parsed = JSON.parse(rawJson);
      replaceActiveBankWithJson(parsed);
      setRawJson("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Invalid JSON.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto p-4 md:p-8 grid lg:grid-cols-[320px_1fr] gap-6">
        <aside className="space-y-6">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <BookOpen className="w-5 h-5" /> QBank Builder
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Bank name"
                value={bankImportName}
                onChange={(e) => setBankImportName(e.target.value)}
              />
              <div className="flex gap-2">
                <Button className="rounded-xl flex-1" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4 mr-2" /> Import JSON
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="rounded-xl">Paste</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl rounded-2xl">
                    <DialogHeader>
                      <DialogTitle>Paste JSON</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <Textarea
                        value={rawJson}
                        onChange={(e) => setRawJson(e.target.value)}
                        className="min-h-[280px]"
                        placeholder='Paste your JSON bank here…'
                      />
                      <div className="flex justify-between gap-2">
                        <Button variant="outline" onClick={() => setRawJson("")}>Clear</Button>
                        <Button onClick={importFromTextarea}>Create new bank</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={onFileImport} className="hidden" />
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="w-4 h-4" /> Banks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bankIds.length === 0 && (
                <p className="text-sm text-slate-500">No banks yet. Import one and this app will remember your progress locally.</p>
              )}
              {bankIds.map((id) => {
                const bank = state.banks[id];
                const count = bank.questions.length;
                const answered = Object.values(bank.progress).filter((p) => p.answered).length;
                const isActive = state.activeBankId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveBank(id)}
                    className={classNames(
                      "w-full text-left rounded-2xl border p-3 transition",
                      isActive ? "border-slate-900 bg-white" : "border-slate-200 bg-slate-50 hover:bg-white"
                    )}
                  >
                    <div className="font-medium">{bank.name}</div>
                    <div className="text-xs text-slate-500 mt-1">{answered}/{count} answered</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {activeBank && stats && (
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Completed</span>
                    <span>{stats.answered}/{stats.total}</span>
                  </div>
                  <Progress value={(stats.answered / Math.max(stats.total, 1)) * 100} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border p-3 bg-white">Correct<br /><span className="text-lg font-semibold">{stats.correct}</span></div>
                  <div className="rounded-xl border p-3 bg-white">Incorrect<br /><span className="text-lg font-semibold">{stats.incorrect}</span></div>
                  <div className="rounded-xl border p-3 bg-white">Flagged<br /><span className="text-lg font-semibold">{stats.flagged}</span></div>
                  <div className="rounded-xl border p-3 bg-white">Unseen<br /><span className="text-lg font-semibold">{stats.unseen}</span></div>
                </div>
                <div className="grid gap-2">
                  <Button variant="outline" onClick={exportProgress} className="rounded-xl">Export progress</Button>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="rounded-xl">Update active bank JSON</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl rounded-2xl">
                      <DialogHeader>
                        <DialogTitle>Replace questions in active bank</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <p className="text-sm text-slate-500">
                          Keep the same question IDs to preserve progress when you update the JSON.
                        </p>
                        <Textarea
                          value={rawJson}
                          onChange={(e) => setRawJson(e.target.value)}
                          className="min-h-[280px]"
                          placeholder='Paste updated JSON for this bank…'
                        />
                        <Button onClick={importReplacementJson}>Apply update</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button variant="outline" onClick={resetBankProgress} className="rounded-xl">
                    <RotateCcw className="w-4 h-4 mr-2" /> Reset progress
                  </Button>
                  <Button variant="destructive" onClick={deleteActiveBank} className="rounded-xl">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete bank
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </aside>

        <main className="space-y-6">
          {!activeBank ? (
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="py-16 text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-2xl border flex items-center justify-center bg-white">
                  <ImageIcon className="w-7 h-7" />
                </div>
                <h2 className="text-2xl font-semibold">Import your first qbank</h2>
                <p className="text-slate-500 max-w-xl mx-auto">
                  Your banks and progress are stored in localStorage, so the app remembers what you already did on this browser.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="rounded-2xl shadow-sm">
                <CardContent className="py-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                  <div>
                    <h1 className="text-2xl font-semibold">{activeBank.name}</h1>
                    <p className="text-sm text-slate-500">{activeBank.questions.length} questions</p>
                  </div>
                  <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                    <div className="relative min-w-[260px]">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stem, system, topic" className="pl-9 rounded-xl" />
                    </div>
                    <Select value={filter} onValueChange={setFilter}>
                      <SelectTrigger className="w-full md:w-[180px] rounded-xl">
                        <SelectValue placeholder="Filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="unseen">Unseen</SelectItem>
                        <SelectItem value="unanswered">Unanswered</SelectItem>
                        <SelectItem value="correct">Correct</SelectItem>
                        <SelectItem value="incorrect">Incorrect</SelectItem>
                        <SelectItem value="flagged">Flagged</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <div className="grid xl:grid-cols-[1fr_300px] gap-6">
                <div className="space-y-4">
                  {currentQuestion && currentStatus ? (
                    <>
                      <div className="flex items-center justify-between text-sm text-slate-500">
                        <span>Question {currentIndex + 1} of {filteredQuestions.length}</span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={currentIndex === 0}
                            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                          >
                            Previous
                          </Button>
                          <Button
                            className="rounded-xl"
                            disabled={currentIndex >= filteredQuestions.length - 1}
                            onClick={() => setCurrentIndex((i) => Math.min(filteredQuestions.length - 1, i + 1))}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                      <QuestionCard
                        question={currentQuestion}
                        status={currentStatus}
                        onAnswer={answerQuestion}
                        onToggleFlag={toggleFlag}
                        revealMode
                      />
                    </>
                  ) : (
                    <Card className="rounded-2xl shadow-sm">
                      <CardContent className="py-16 text-center text-slate-500">
                        No questions match this filter. Tiny tragedy. Huge solvable one.
                      </CardContent>
                    </Card>
                  )}
                </div>

                <Card className="rounded-2xl shadow-sm h-fit">
                  <CardHeader>
                    <CardTitle className="text-base">Navigator</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[600px] pr-3">
                      <div className="grid grid-cols-5 gap-2">
                        {filteredQuestions.map((q, i) => {
                          const p = activeBank.progress[q.id];
                          return (
                            <button
                              key={q.id}
                              onClick={() => setCurrentIndex(i)}
                              className={classNames(
                                "h-11 rounded-xl border text-sm font-medium",
                                i === currentIndex && "border-slate-900",
                                p.correct === true && "bg-slate-100",
                                p.correct === false && "bg-slate-200",
                                !p.answered && "bg-white",
                                p.flagged && "ring-2 ring-offset-1"
                              )}
                              title={`${q.system} · ${q.topic}`}
                            >
                              {i + 1}
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
