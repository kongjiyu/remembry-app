"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Palette, Moon, Sun, Monitor, KeyRound, Loader2, CheckCircle2, AlertCircle, ExternalLink, Copy, Trash2, Eye, EyeOff, RefreshCw, Download, Cpu } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
    subscribeToUpdates,
    checkForUpdates,
    downloadAndInstall,
    getCurrentStatus,
    type UpdateStatus,
} from "@/lib/appUpdater";

interface ApiKeyStatus {
    hasKey: boolean;
    maskedKey: string | null;
    keyPrefix: string | null;
    keySuffix: string | null;
    createdAt: string | null;
    lastUsed: string | null;
    usageCount: number;
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string" && error.trim()) {
        return error;
    }
    return fallback;
}

async function loadGeminiKeyStatus(): Promise<ApiKeyStatus> {
    return invoke<ApiKeyStatus>("get_gemini_key_status");
}

async function saveGeminiKey(apiKey: string): Promise<void> {
    await invoke("save_gemini_key", { apiKey });
}

async function deleteGeminiKey(): Promise<void> {
    await invoke("delete_gemini_key");
}

interface GroqKeyStatus {
    hasKey: boolean;
    maskedKey: string | null;
    keyPrefix: string | null;
    keySuffix: string | null;
}

async function loadGroqKeyStatus(): Promise<GroqKeyStatus> {
    return invoke<GroqKeyStatus>("get_groq_key_status");
}

async function saveGroqKey(apiKey: string): Promise<void> {
    await invoke("save_groq_key", { apiKey });
}

async function deleteGroqKey(): Promise<void> {
    await invoke("delete_groq_key");
}

interface ProviderConfig {
    transcription: "groq" | "gemini";
    extraction: "groq" | "openai_compatible" | "gemini";
    groq_transcription_model: "whisper_large_v3" | "whisper_large_v3_turbo";
    groq_extraction_model: "llama_33_70b" | "llama_4_scout" | "qwen_3_32b" | "gpt_oss_120b";
    custom_base_url: string | null;
    custom_model: string | null;
    groq_api_key?: string | null;
    custom_api_key?: string | null;
}

async function loadProviderConfig(): Promise<ProviderConfig> {
    return invoke<ProviderConfig>("get_provider_config");
}

async function saveProviderConfig(config: ProviderConfig): Promise<void> {
    await invoke("save_provider_config", { config });
}

export default function SettingsPage() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
    const [isSavingKey, setIsSavingKey] = useState(false);
    const [isLoadingKeyStatus, setIsLoadingKeyStatus] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
    const [updateInfo, setUpdateInfo] = useState<{ version: string; notes?: string } | null>(null);
    const [updateProgress, setUpdateProgress] = useState(0);
    const [updateErrorMessage, setUpdateErrorMessage] = useState<string | null>(null);
    const [appVersion, setAppVersion] = useState<string>("");
    const [groqKey, setGroqKey] = useState("");
    const [groqKeyStatus, setGroqKeyStatus] = useState<GroqKeyStatus | null>(null);
    const [isSavingGroqKey, setIsSavingGroqKey] = useState(false);
    const [isDeletingGroqKey, setIsDeletingGroqKey] = useState(false);
    const [showGroqKey, setShowGroqKey] = useState(false);
    const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Subscribe to update status
    useEffect(() => {
        const unsub = subscribeToUpdates((status, info) => {
            setUpdateStatus(status);
            setUpdateInfo(info ?? null);
            if (status === "error") {
                setUpdateErrorMessage(getCurrentStatus().errorMessage ?? "An error occurred while checking for updates.");
            } else {
                setUpdateErrorMessage(null);
            }
        });
        return unsub;
    }, []);

    useEffect(() => {
        getVersion().then((v) => setAppVersion(v)).catch(() => {});
    }, []);

    useEffect(() => {
        const refreshGeminiKeyStatus = async () => {
            setIsLoadingKeyStatus(true);
            try {
                const data = await loadGeminiKeyStatus();
                setApiKeyStatus(data);
            } catch (error) {
                console.error("Failed to load key status:", error);
            } finally {
                setIsLoadingKeyStatus(false);
            }
        };

        refreshGeminiKeyStatus();
    }, []);

    useEffect(() => {
        const refreshProviderData = async () => {
            try {
                const [cfg, groqStatus] = await Promise.all([
                    loadProviderConfig(),
                    loadGroqKeyStatus(),
                ]);
                setProviderConfig(cfg);
                setGroqKeyStatus(groqStatus);
            } catch (error) {
                console.error("Failed to load provider config:", error);
            }
        };
        refreshProviderData();
    }, []);

    const handleSaveApiKey = async () => {
        if (!apiKey.trim()) {
            toast.error("Please enter a Gemini API key.");
            return;
        }

        const trimmedApiKey = apiKey.trim();

        if (!trimmedApiKey.startsWith("AIza")) {
            toast.error("Invalid Gemini API key format. Key should start with 'AIza'.");
            return;
        }

        setIsSavingKey(true);
        try {
            await saveGeminiKey(trimmedApiKey);
            const statusData = await loadGeminiKeyStatus();
            setApiKeyStatus(statusData);
            setApiKey("");
            toast.success("Gemini API key saved successfully.");
        } catch (error) {
            console.error("Failed to save Gemini API key:", error);
            const message = getErrorMessage(error, "Failed to save key");
            toast.error(message);
        } finally {
            setIsSavingKey(false);
        }
    };

    const handleDeleteApiKey = async () => {
        setIsDeleting(true);
        try {
            await deleteGeminiKey();
            setApiKeyStatus({
                hasKey: false,
                maskedKey: null,
                keyPrefix: null,
                keySuffix: null,
                createdAt: null,
                lastUsed: null,
                usageCount: 0,
            });
            toast.success("Gemini API key deleted.");
        } catch (error) {
            console.error("Failed to delete Gemini API key:", error);
            toast.error("Failed to delete API key.");
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSaveGroqKey = async () => {
        const trimmed = groqKey.trim();
        if (!trimmed) {
            toast.error("Please enter a Groq API key.");
            return;
        }
        if (!trimmed.startsWith("gsk_")) {
            toast.error("Invalid Groq API key format. Keys start with 'gsk_'.");
            return;
        }
        setIsSavingGroqKey(true);
        try {
            await saveGroqKey(trimmed);
            const status = await loadGroqKeyStatus();
            setGroqKeyStatus(status);
            setGroqKey("");
            toast.success("Groq API key saved.");
        } catch (error) {
            console.error("Failed to save Groq API key:", error);
            toast.error(getErrorMessage(error, "Failed to save Groq key"));
        } finally {
            setIsSavingGroqKey(false);
        }
    };

    const handleDeleteGroqKey = async () => {
        setIsDeletingGroqKey(true);
        try {
            await deleteGroqKey();
            setGroqKeyStatus({ hasKey: false, maskedKey: null, keyPrefix: null, keySuffix: null });
            toast.success("Groq API key deleted.");
        } catch (error) {
            console.error("Failed to delete Groq key:", error);
            toast.error("Failed to delete Groq API key.");
        } finally {
            setIsDeletingGroqKey(false);
        }
    };

    const handleSaveProviderConfig = async () => {
        if (!providerConfig) return;
        setIsSavingConfig(true);
        try {
            // Embed any in-progress Groq key input so the backend writes it to the keyring.
            const trimmedGroq = groqKey.trim();
            const toSave: ProviderConfig = {
                ...providerConfig,
                groq_api_key: trimmedGroq || null,
            };
            await saveProviderConfig(toSave);
            const [cfg, groqStatus] = await Promise.all([
                loadProviderConfig(),
                loadGroqKeyStatus(),
            ]);
            setProviderConfig(cfg);
            setGroqKeyStatus(groqStatus);
            setGroqKey("");
            toast.success("Provider settings saved.");
        } catch (error) {
            console.error("Failed to save provider config:", error);
            toast.error(getErrorMessage(error, "Failed to save provider settings"));
        } finally {
            setIsSavingConfig(false);
        }
    };

    const copyApiKey = () => {
        if (apiKeyStatus?.maskedKey) {
            navigator.clipboard.writeText(apiKeyStatus.maskedKey);
            toast.success("API key prefix copied to clipboard.");
        }
    };

    const formatDate = (dateString: string | null) => {
        if (!dateString) return "Never";
        return new Date(dateString).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    if (!mounted) {
        return (
            <DashboardLayout breadcrumbs={[{ label: "Settings" }]} title="Settings">
                <div className="max-w-3xl animate-pulse">
                    <div className="h-48 bg-muted rounded-xl"></div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout breadcrumbs={[{ label: "Settings" }]} title="Settings">
            <div className="max-w-3xl space-y-6">
                {/* App Updates */}
                <Card className="border-none shadow-sm bg-card/50 backdrop-blur-xl">
                    <CardHeader>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <RefreshCw className="size-5" />
                            </div>
                            <div>
                                <CardTitle>App Updates</CardTitle>
                                <CardDescription>Keep Remembry up to date</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="text-sm">
                                <span className="text-muted-foreground">Current version: </span>
                                <span className="font-medium">{appVersion ? `v${appVersion}` : "..."}</span>
                            </div>
                            {updateStatus === "available" && updateInfo && (
                                <Badge variant="default" className="bg-primary">New version available</Badge>
                            )}
                            {updateStatus === "upToDate" && (
                                <Badge variant="secondary" className="flex items-center gap-1">
                                    <CheckCircle2 className="size-3" /> Up to date
                                </Badge>
                            )}
                            {updateStatus === "error" && (
                                <Badge variant="destructive" className="flex items-center gap-1">
                                    <AlertCircle className="size-3" /> Error
                                </Badge>
                            )}
                        </div>
                        {updateStatus === "error" && updateErrorMessage && (
                            <p className="text-sm text-destructive">{updateErrorMessage}</p>
                        )}
                        {updateStatus === "available" && updateInfo?.notes && (
                            <div className="p-3 rounded-lg bg-muted/50 border text-sm text-muted-foreground max-h-32 overflow-y-auto">
                                {updateInfo.notes}
                            </div>
                        )}
                        {updateStatus === "downloading" && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Downloading...</span>
                                    <span className="font-medium">{updateProgress}%</span>
                                </div>
                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-primary transition-all" style={{ width: `${updateProgress}%` }} />
                                </div>
                            </div>
                        )}
                        <div className="flex gap-3">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => checkForUpdates()}
                                disabled={updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing"}
                            >
                                {updateStatus === "checking" ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="size-4" />
                                )}
                                Check for updates
                            </Button>
                            {updateStatus === "available" && (
                                <Button
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => downloadAndInstall((p) => setUpdateProgress(p))}
                                >
                                    <Download className="size-4" />
                                    Update Now
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Appearance / Preferences */}
                <Card className="border-none shadow-sm bg-card/50 backdrop-blur-xl">
                    <CardHeader>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <Palette className="size-5" />
                            </div>
                            <div>
                                <CardTitle>Appearance</CardTitle>
                                <CardDescription>Customize how Remembry looks on your device</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-4">
                            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Theme Mode</p>
                            <div className="grid grid-cols-3 gap-4">
                                <Button
                                    variant={theme === "light" ? "default" : "outline"}
                                    className="flex flex-col items-center gap-2 h-24 rounded-xl transition-all"
                                    onClick={() => setTheme("light")}
                                >
                                    <Sun className="size-5" />
                                    <span>Light</span>
                                </Button>
                                <Button
                                    variant={theme === "dark" ? "default" : "outline"}
                                    className="flex flex-col items-center gap-2 h-24 rounded-xl transition-all"
                                    onClick={() => setTheme("dark")}
                                >
                                    <Moon className="size-5" />
                                    <span>Dark</span>
                                </Button>
                                <Button
                                    variant={theme === "system" ? "default" : "outline"}
                                    className="flex flex-col items-center gap-2 h-24 rounded-xl transition-all"
                                    onClick={() => setTheme("system")}
                                >
                                    <Monitor className="size-5" />
                                    <span>System</span>
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* AI Providers */}
                <Card className="border-none shadow-sm bg-card/50 backdrop-blur-xl">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                    <Cpu className="size-5" />
                                </div>
                                <div>
                                    <CardTitle>AI Providers</CardTitle>
                                    <CardDescription>
                                        Choose which backend powers transcription and extraction
                                    </CardDescription>
                                </div>
                            </div>
                            <Badge variant={providerConfig ? "default" : "secondary"} className="px-3 py-1">
                                {providerConfig ? (
                                    <span className="flex items-center gap-1">
                                        <CheckCircle2 className="size-3" /> Loaded
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1">
                                        <Loader2 className="size-3 animate-spin" /> Loading
                                    </span>
                                )}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {providerConfig && (
                            <>
                                {/* Transcription */}
                                <div className="space-y-2">
                                    <Label>Transcription Provider</Label>
                                    <Select
                                        value={providerConfig.transcription}
                                        onValueChange={(v) =>
                                            setProviderConfig({ ...providerConfig, transcription: v as "groq" | "gemini" })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="groq">Groq Whisper (Free)</SelectItem>
                                            <SelectItem value="gemini">Gemini (Fallback)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {providerConfig.transcription === "groq" && (
                                    <div className="space-y-2">
                                        <Label>Whisper Model</Label>
                                        <Select
                                            value={providerConfig.groq_transcription_model}
                                            onValueChange={(v) =>
                                                setProviderConfig({
                                                    ...providerConfig,
                                                    groq_transcription_model: v as "whisper_large_v3" | "whisper_large_v3_turbo",
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="whisper_large_v3">whisper-large-v3 (Best quality)</SelectItem>
                                                <SelectItem value="whisper_large_v3_turbo">whisper-large-v3-turbo (Fastest)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {/* Extraction */}
                                <div className="space-y-2">
                                    <Label>Extraction Provider</Label>
                                    <Select
                                        value={providerConfig.extraction}
                                        onValueChange={(v) =>
                                            setProviderConfig({
                                                ...providerConfig,
                                                extraction: v as "groq" | "openai_compatible" | "gemini",
                                            })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="groq">Groq LLM (Free)</SelectItem>
                                            <SelectItem value="openai_compatible">Custom Provider (OpenAI-compatible)</SelectItem>
                                            <SelectItem value="gemini">Gemini (Fallback)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {providerConfig.extraction === "groq" && (
                                    <div className="space-y-2">
                                        <Label>Extraction Model</Label>
                                        <Select
                                            value={providerConfig.groq_extraction_model}
                                            onValueChange={(v) =>
                                                setProviderConfig({
                                                    ...providerConfig,
                                                    groq_extraction_model: v as ProviderConfig["groq_extraction_model"],
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="llama_33_70b">Llama 3.3 70B (Best)</SelectItem>
                                                <SelectItem value="llama_4_scout">Llama 4 Scout</SelectItem>
                                                <SelectItem value="qwen_3_32b">Qwen 3 32B</SelectItem>
                                                <SelectItem value="gpt_oss_120b">GPT OSS 120B</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {providerConfig.extraction === "openai_compatible" && (
                                    <div className="space-y-4 rounded-lg border p-4">
                                        <div className="space-y-2">
                                            <Label>Base URL</Label>
                                            <Input
                                                placeholder="https://api.example.com/v1"
                                                value={providerConfig.custom_base_url ?? ""}
                                                onChange={(e) =>
                                                    setProviderConfig({
                                                        ...providerConfig,
                                                        custom_base_url: e.target.value || null,
                                                    })
                                                }
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Presets: OpenCode Go (opencode.ai/zen/go/v1) · DeepSeek (api.deepseek.com) · OpenRouter (openrouter.ai/api/v1)
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Model Name</Label>
                                            <Input
                                                placeholder="deepseek-chat"
                                                value={providerConfig.custom_model ?? ""}
                                                onChange={(e) =>
                                                    setProviderConfig({
                                                        ...providerConfig,
                                                        custom_model: e.target.value || null,
                                                    })
                                                }
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Groq Key input — always available when Groq is in use */}
                                {(providerConfig.transcription === "groq" || providerConfig.extraction === "groq") && (
                                    <div className="space-y-2 rounded-lg border p-4">
                                        <div className="flex items-center justify-between">
                                            <Label>Groq API Key</Label>
                                            <Badge variant={groqKeyStatus?.hasKey ? "default" : "secondary"} className="px-2 py-0.5 text-xs">
                                                {groqKeyStatus?.hasKey ? "Configured" : "Not Set"}
                                            </Badge>
                                        </div>
                                        <div className="relative">
                                            <Input
                                                type={showGroqKey ? "text" : "password"}
                                                placeholder="gsk_..."
                                                value={groqKey}
                                                onChange={(e) => setGroqKey(e.target.value)}
                                                autoComplete="off"
                                                className="pr-20"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-2"
                                                onClick={() => setShowGroqKey(!showGroqKey)}
                                            >
                                                {showGroqKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                onClick={handleSaveGroqKey}
                                                disabled={isSavingGroqKey || !groqKey.trim()}
                                            >
                                                {isSavingGroqKey ? (
                                                    <Loader2 className="size-4 mr-1 animate-spin" />
                                                ) : (
                                                    <CheckCircle2 className="size-4 mr-1" />
                                                )}
                                                Save Groq Key
                                            </Button>
                                            {groqKeyStatus?.hasKey && (
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={handleDeleteGroqKey}
                                                    disabled={isDeletingGroqKey}
                                                >
                                                    {isDeletingGroqKey ? (
                                                        <Loader2 className="size-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="size-4" />
                                                    )}
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Free at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="underline">console.groq.com/keys</a>.
                                            Saved to OS credential store.
                                        </p>
                                    </div>
                                )}

                                {/* Save the full config (which includes any embedded key) */}
                                <Button
                                    onClick={handleSaveProviderConfig}
                                    disabled={isSavingConfig}
                                    className="w-full"
                                >
                                    {isSavingConfig ? (
                                        <Loader2 className="size-4 mr-2 animate-spin" />
                                    ) : (
                                        <CheckCircle2 className="size-4 mr-2" />
                                    )}
                                    Save Provider Settings
                                </Button>
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Gemini API Key Management */}
                <Card className="border-none shadow-sm bg-card/50 backdrop-blur-xl">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                    <KeyRound className="size-5" />
                                </div>
                                <div>
                                    <CardTitle>Gemini API Key</CardTitle>
                                    <CardDescription>
                                        Manage your Gemini API key for AI-powered features
                                    </CardDescription>
                                </div>
                            </div>
                            <Badge variant={apiKeyStatus?.hasKey ? "default" : "secondary"} className="px-3 py-1">
                                {isLoadingKeyStatus ? (
                                    <span className="flex items-center gap-1">
                                        <Loader2 className="size-3 animate-spin" /> Checking
                                    </span>
                                ) : apiKeyStatus?.hasKey ? (
                                    <span className="flex items-center gap-1">
                                        <CheckCircle2 className="size-3" /> Configured
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1">
                                        <AlertCircle className="size-3" /> Not Set
                                    </span>
                                )}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* API Key Status Display */}
                        {apiKeyStatus?.hasKey && (
                            <div className="p-4 rounded-xl bg-muted/50 border space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">Current API Key</span>
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="sm" onClick={copyApiKey} className="h-8 px-2">
                                            <Copy className="size-3 mr-1" />
                                            Copy
                                        </Button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 text-sm bg-background px-3 py-2 rounded-lg border font-mono">
                                        {apiKeyStatus.maskedKey || `${apiKeyStatus.keyPrefix}...${apiKeyStatus.keySuffix}`}
                                    </code>
                                </div>
                                <div className="grid grid-cols-3 gap-4 pt-2 text-xs text-muted-foreground">
                                    <div>
                                        <span className="font-medium">Created</span>
                                        <p>{formatDate(apiKeyStatus.createdAt)}</p>
                                    </div>
                                    <div>
                                        <span className="font-medium">Last Used</span>
                                        <p>{formatDate(apiKeyStatus.lastUsed)}</p>
                                    </div>
                                    <div>
                                        <span className="font-medium">Usage Count</span>
                                        <p>{apiKeyStatus.usageCount.toLocaleString()} requests</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Add New API Key */}
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <label htmlFor="gemini-api-key" className="text-sm font-medium">
                                    {apiKeyStatus?.hasKey ? "Replace API Key" : "Enter your Gemini API Key"}
                                </label>
                                <div className="relative">
                                    <Input
                                        id="gemini-api-key"
                                        type={showApiKey ? "text" : "password"}
                                        placeholder="AIza..."
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        autoComplete="off"
                                        className="pr-20"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-2"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                    >
                                        {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                    </Button>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    onClick={handleSaveApiKey}
                                    disabled={isSavingKey || !apiKey.trim()}
                                    className="flex-1"
                                >
                                    {isSavingKey ? (
                                        <>
                                            <Loader2 className="size-4 mr-2 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="size-4 mr-2" />
                                            {apiKeyStatus?.hasKey ? "Update API Key" : "Save API Key"}
                                        </>
                                    )}
                                </Button>

                                {apiKeyStatus?.hasKey && (
                                    <Button
                                        variant="destructive"
                                        onClick={handleDeleteApiKey}
                                        disabled={isDeleting}
                                    >
                                        {isDeleting ? (
                                            <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="size-4" />
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Help Link */}
                        <div className="pt-2 border-t">
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                            >
                                <ExternalLink className="size-3" />
                                Get your Gemini API key from Google AI Studio
                            </a>
                        </div>
                    </CardContent>
                </Card>

                {/* Database Info */}
                <Card className="border-none shadow-sm bg-card/50 backdrop-blur-xl">
                    <CardHeader>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <KeyRound className="size-5" />
                            </div>
                            <div>
                                <CardTitle>Local Storage</CardTitle>
                                <CardDescription>
                                    Your data is stored locally in SQLite
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="text-sm text-muted-foreground space-y-2">
                            <p>All your meetings, projects, and settings are stored in your local SQLite database.</p>
                            <p>The API key is stored securely and only used for AI requests.</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
