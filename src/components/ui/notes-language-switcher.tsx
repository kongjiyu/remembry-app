"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Languages, Loader2, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiFetch";

const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文 (Chinese)' },
    { code: 'ms', name: 'Bahasa Melayu' },
    { code: 'ja', name: '日本語 (Japanese)' },
    { code: 'ko', name: '한국어 (Korean)' },
    { code: 'es', name: 'Español (Spanish)' },
    { code: 'fr', name: 'Français (French)' },
    { code: 'de', name: 'Deutsch (German)' },
    { code: 'pt', name: 'Português (Portuguese)' },
    { code: 'it', name: 'Italiano (Italian)' },
    { code: 'th', name: 'ไทย (Thai)' },
    { code: 'vi', name: 'Tiếng Việt (Vietnamese)' },
    { code: 'id', name: 'Bahasa Indonesia' },
];

interface MeetingNotes {
    summary: string;
    keyTopics: string[];
    actionItems: string[];
    decisions: string[];
    assumptions: string[];
    qa: Array<{ question: string; answer: string }>;
}

interface NotesLanguageSwitcherProps {
    meetingId: string;
    availableLanguages?: string[];
    currentLanguage?: string;
    onNotesChange: (notes: MeetingNotes, language: string) => void;
}

export function NotesLanguageSwitcher({
    meetingId,
    availableLanguages: initialAvailableLanguages,
    currentLanguage = 'en',
    onNotesChange
}: NotesLanguageSwitcherProps) {
    const [selectedLanguage, setSelectedLanguage] = useState(currentLanguage);
    const [availableLanguages, setAvailableLanguages] = useState<string[]>(initialAvailableLanguages || [currentLanguage]);
    const [isLoading, setIsLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Fetch metadata on mount to get available languages
    useEffect(() => {
        const fetchMetadata = async () => {
            try {
                const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/metadata`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.availableLanguages && data.availableLanguages.length > 0) {
                        setAvailableLanguages(data.availableLanguages);
                        // If current language is not available, switch to default
                        if (!data.availableLanguages.includes(selectedLanguage)) {
                            setSelectedLanguage(data.defaultLanguage || data.availableLanguages[0]);
                        }
                    }
                }
            } catch (error) {
                console.error("Error fetching metadata:", error);
            }
        };
        
        if (!initialAvailableLanguages) {
            fetchMetadata();
        }
    }, [meetingId, initialAvailableLanguages, selectedLanguage]);

    const handleLanguageChange = async (langCode: string) => {
        if (langCode === selectedLanguage) return;

        setIsLoading(true);
        try {
            // Get cached notes for this language
            const getResponse = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/regenerate-notes?language=${langCode}`);
            const getData = await getResponse.json();

            if (getData.notes && !getData.needsRegeneration) {
                setSelectedLanguage(langCode);
                onNotesChange(getData.notes, langCode);
                toast.success(`Switched to ${SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name}`);
            } else {
                toast.error("Notes not available in this language");
            }
        } catch (error) {
            console.error("Error changing language:", error);
            toast.error("Failed to switch language. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateNewLanguage = async (langCode: string) => {
        setIsGenerating(true);
        try {
            toast.info(`Generating notes in ${SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name}...`);
            
            const postResponse = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/regenerate-notes`, {
                method: 'POST',
                body: JSON.stringify({ language: langCode })
            });

            if (!postResponse.ok) {
                throw new Error("Failed to generate notes");
            }

            const postData = await postResponse.json();
            
            // Add to available languages
            setAvailableLanguages(prev => [...prev, langCode]);
            setSelectedLanguage(langCode);
            onNotesChange(postData.notes, langCode);
            toast.success(`Notes generated in ${SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name}`);
        } catch (error) {
            console.error("Error generating notes:", error);
            toast.error("Failed to generate notes. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    const availableLangsData = SUPPORTED_LANGUAGES.filter(l => availableLanguages.includes(l.code));
    const unavailableLangsData = SUPPORTED_LANGUAGES.filter(l => !availableLanguages.includes(l.code));

    return (
        <div className="flex items-center gap-2">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isLoading || isGenerating} className="gap-2">
                        {(isLoading || isGenerating) ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Languages className="size-4" />
                        )}
                        {SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.name || 'English'}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px] max-h-[400px] overflow-y-auto">
                    {/* Available Languages */}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Available Languages
                    </div>
                    {availableLangsData.map((lang) => (
                        <DropdownMenuItem
                            key={lang.code}
                            onClick={() => handleLanguageChange(lang.code)}
                            className={cn(
                                "flex items-center justify-between cursor-pointer",
                                selectedLanguage === lang.code && "bg-primary/10"
                            )}
                        >
                            <span>{lang.name}</span>
                            {selectedLanguage === lang.code && (
                                <Check className="size-4 text-primary" />
                            )}
                        </DropdownMenuItem>
                    ))}
                    
                    {unavailableLangsData.length > 0 && (
                        <>
                            <DropdownMenuSeparator />
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                Generate New Language
                            </div>
                            {unavailableLangsData.map((lang) => (
                                <DropdownMenuItem
                                    key={lang.code}
                                    onClick={() => handleGenerateNewLanguage(lang.code)}
                                    disabled={isGenerating}
                                    className="flex items-center justify-between cursor-pointer text-muted-foreground hover:text-foreground"
                                >
                                    <span>{lang.name}</span>
                                    <Plus className="size-4" />
                                </DropdownMenuItem>
                            ))}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
