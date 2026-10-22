import React, {useState, useEffect, useRef, useMemo, useReducer, useCallback, useId} from "react";
import {Dialog} from "../ui/components/Dialog";
import {Button, IconButton} from "../ui/components/Button";
import {Field, Input, Checkbox, Textarea} from "../ui/components/Field";
import {Table, HeaderRow, HeaderCell, Row, Cell} from "../ui/components/Table";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {EyeIcon, EyeOffIcon, FileIcon, PencilIcon, PlusIcon, SlidersIcon, TrashIcon, UploadIcon} from "../ui/icons";
import {formatSeconds, useAutoHide} from "../ui/lib/reveal";
import {URL_OBJECT} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils";
import {useTranslation} from "react-i18next";
import {ConfigText} from "./ConfigText";
import {CopyButton} from "../ui/components/CopyButton";
import {extractSection, replaceSection} from "../utils/configSections";
import {trackDone, trackRefused, trackWrite} from "../app/action-tracker";
import {newId, withId} from "../app/object-create";

/**
 * The object configuration file, its secrets redacted unless `showSecrets`: the
 * object endpoint takes `redact-secrets` (the instance endpoint ignores it), and
 * forwards the request to a node holding an instance when the one answering has none.
 */
const useConfig = (decodedObjectName, configNode, setConfigNode, refreshTrigger, showSecrets = false) => {
    const initialState = {
        data: null,
        loading: false,
        error: null,
    };
    const reducer = (state, action) => {
        switch (action.type) {
            case "FETCH_START":
                return {...state, loading: true, error: null};
            case "FETCH_SUCCESS":
                return {...state, loading: false, data: action.payload};
            case "FETCH_ERROR":
                return {...state, loading: false, error: action.payload};
            case "RESET":
                return initialState;
            /* istanbul ignore next */
            default:
                return state;
        }
    };
    const {t} = useTranslation();
    const [state, dispatch] = useReducer(reducer, initialState);
    const lastFetch = useRef({});

    const fetchConfig = useCallback(async (node, forceBypassThrottle = false) => {
        /* istanbul ignore next */
        if (!node) {
            dispatch({type: "RESET"});
            return;
        }
        // The redaction is part of the key: switching it must not be throttled away.
        const key = `${decodedObjectName}:${node}:${showSecrets}`;
        const now = Date.now();
        if (!forceBypassThrottle && lastFetch.current[key] && now - lastFetch.current[key] < 1000) return;
        lastFetch.current[key] = now;
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        const token = localStorage.getItem("authToken") || "";
        dispatch({type: "FETCH_START"});
        setConfigNode(node);
        try {
            const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file?redact-secrets=${!showSecrets}`, {
                headers: {Authorization: `Bearer ${token}`},
                cache: "no-cache",
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchConfig", {message: error.message})});
                return;
            }
            const text = await response.text();
            dispatch({type: "FETCH_SUCCESS", payload: text});
        } catch (err) {
            dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchConfig", {message: err.message})});
        }
    }, [decodedObjectName, setConfigNode, showSecrets, t]);

    // Showing or hiding the secrets always reloads, throttle or not, and drops the
    // text first: a revealed secret must not stay on screen while hiding them.
    const prevShowSecrets = useRef(showSecrets);
    useEffect(() => {
        const secretsToggled = prevShowSecrets.current !== showSecrets;
        prevShowSecrets.current = showSecrets;
        if (secretsToggled) dispatch({type: "RESET"});
        if (configNode) {
            void fetchConfig(configNode, secretsToggled);
        } else {
            dispatch({type: "RESET"});
        }
    }, [configNode, decodedObjectName, fetchConfig, showSecrets]);

    const prevRefreshTrigger = useRef(refreshTrigger);
    useEffect(() => {
        if (refreshTrigger === prevRefreshTrigger.current) return;
        prevRefreshTrigger.current = refreshTrigger;
        if (configNode) {
            void fetchConfig(configNode, true);
        }
    }, [refreshTrigger, configNode, fetchConfig]);

    return {...state, fetchConfig};
};

const useKeywords = (decodedObjectName) => {
    const initialState = {
        data: null,
        loading: false,
        error: null,
    };
    const reducer = (state, action) => {
        switch (action.type) {
            case "FETCH_START":
                return {...state, loading: true, error: null};
            case "FETCH_SUCCESS":
                return {...state, loading: false, data: action.payload};
            case "FETCH_ERROR":
                return {...state, loading: false, error: action.payload};
            /* istanbul ignore next */
            default:
                return state;
        }
    };
    const {t} = useTranslation();
    const [state, dispatch] = useReducer(reducer, initialState);
    const fetchKeywords = async () => {
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        const token = localStorage.getItem("authToken") || "";
        dispatch({type: "FETCH_START"});
        const timeout = 60000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/keywords`, {
                headers: {Authorization: `Bearer ${token}`},
                cache: "no-cache",
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchKeywords", {message: error.message})});
                return;
            }
            const data = await response.json();
            if (!data || !Array.isArray(data.items)) {
                const error = new Error(t("config.errors.invalidFormat"));
                dispatch({type: "FETCH_ERROR", payload: error.message});
                return;
            }
            const seen = new Set();
            const uniqueKeywords = data.items.filter((item) => {
                const key = `${item.section || "default"}.${item.option}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            dispatch({type: "FETCH_SUCCESS", payload: uniqueKeywords});
        } catch (err) {
            const errorMsg = err.name === "AbortError" ? t("config.errors.timeout") : t("config.errors.fetchKeywords", {message: err.message});
            dispatch({type: "FETCH_ERROR", payload: errorMsg});
        }
    };
    return {...state, fetchKeywords};
};

const useExistingParams = (decodedObjectName) => {
    const initialState = {
        data: null,
        loading: false,
        error: null,
    };
    const reducer = (state, action) => {
        switch (action.type) {
            case "FETCH_START":
                return {...state, loading: true, error: null};
            case "FETCH_SUCCESS":
                return {...state, loading: false, data: action.payload};
            case "FETCH_ERROR":
                return {...state, loading: false, error: action.payload};
            /* istanbul ignore next */
            default:
                return state;
        }
    };
    const {t} = useTranslation();
    const [state, dispatch] = useReducer(reducer, initialState);
    const fetchExistingParams = async () => {
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        const token = localStorage.getItem("authToken") || "";
        dispatch({type: "FETCH_START"});
        try {
            const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config`, {
                headers: {Authorization: `Bearer ${token}`},
                cache: "no-cache",
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchParams", {message: error.message})});
                return;
            }
            const data = await response.json();
            dispatch({type: "FETCH_SUCCESS", payload: data.items || []});
        } catch (err) {
            dispatch({type: "FETCH_ERROR", payload: t("config.errors.fetchParams", {message: err.message})});
        }
    };
    return {...state, fetchExistingParams};
};

/** "section.option", or "option" alone for a keyword without section. */
/** The configuration file of an object as stored, its secrets in clear, for editing. */
const fetchRawConfigFile = async (decodedObjectName) => {
    const {namespace, kind, name} = parseObjectPath(decodedObjectName);
    const token = localStorage.getItem("authToken") || "";
    const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file?redact-secrets=false`, {
        headers: {Authorization: `Bearer ${token}`},
        cache: "no-cache",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

/** What the daemon says of a refused request: the detail of its problem, else the status. */
const problemMessage = async (response) => {
    try {
        const problem = await response.json();
        if (problem?.detail) return problem.detail;
    } catch {
        // Not a problem document: the status says enough.
    }
    return `HTTP ${response.status}`;
};

/** A refusal in words, for the actions tray: its status, and the detail the daemon gave. */
const refusal = async (response) => {
    const message = await problemMessage(response);
    return message.startsWith("HTTP ") ? message : `HTTP ${response.status} ${message}`;
};

const keywordLabel = (keyword) => `${keyword.section ? `${keyword.section}.` : ""}${keyword.option}`;

/**
 * File picker: the native input, hidden but focusable, behind a label drawn as a
 * secondary button; the chosen file name beside it.
 */
const FilePicker = ({id, file, onChange, disabled, emptyText}) => {
    const {t} = useTranslation();
    return (
    <div className="flex items-center gap-3">
        <input
            id={id}
            type="file"
            className="peer sr-only"
            onChange={(e) => onChange(e.target.files[0])}
            disabled={disabled}
        />
        <label
            htmlFor={id}
            className={
                disabled
                    ? "inline-flex h-8 items-center rounded-(--radius-control) border border-line bg-surface-raised px-3 font-medium opacity-60"
                    : "inline-flex h-8 cursor-pointer items-center rounded-(--radius-control) border border-line bg-surface-raised px-3 font-medium hover:bg-surface-sunken peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus-ring)"
            }
        >
            {t("config.filePicker.choose")}
        </label>
        <span className={file ? "text-ink" : "text-ink-muted"}>{file ? file.name : emptyText}</span>
    </div>
    );
};

const UpdateConfigDialog = ({
                                open,
                                onClose,
                                newConfigFile,
                                setNewConfigFile,
                                actionLoading,
                                handleUpdateConfig,
                            }) => {
    const {t} = useTranslation();
    return (
    <Dialog
        open={open}
        onClose={onClose}
        title={t("config.update.title")}
        size="md"
        footer={
            <>
                <Button onClick={onClose} disabled={actionLoading}>{t("common.cancel")}</Button>
                <Button
                    onClick={handleUpdateConfig}
                    disabled={actionLoading || !newConfigFile}
                    icon={actionLoading ? <Spinner label={t("config.update.updating")}/> : undefined}
                >
                    {t("config.update.submit")}
                </Button>
            </>
        }
    >
        <FilePicker
            id="update-config-file-upload"
            file={newConfigFile}
            onChange={setNewConfigFile}
            disabled={actionLoading}
            emptyText={t("config.filePicker.noFile")}
        />
    </Dialog>
    );
};

/** A group of checkboxes, one per choice, in a bordered scrolling box. */
const CheckboxGroup = ({legend, hint, choices, isChecked, onToggle, disabled, emptyText}) => (
    <fieldset className="space-y-1">
        <legend className="mb-1 font-semibold">{legend}</legend>
        {choices.length === 0 ? (
            <p className="text-ink-muted">{emptyText}</p>
        ) : (
            <div
                className="max-h-40 space-y-1 overflow-y-auto rounded-(--radius-control) border border-line bg-surface px-2 py-1">
                {choices.map(({key, label, value}) => (
                    <div key={key}>
                        <Checkbox
                            label={<span className="font-mono">{label}</span>}
                            checked={isChecked(value)}
                            onChange={() => onToggle(value)}
                            disabled={disabled}
                        />
                    </div>
                ))}
            </div>
        )}
        <p className="text-data text-ink-muted">{hint}</p>
    </fieldset>
);

const ManageParamsDialog = ({
                                open,
                                onClose,
                                keywordsData,
                                existingParams,
                                keywordsLoading,
                                existingParamsLoading,
                                keywordsError,
                                existingParamsError,
                                paramsToSet,
                                setParamsToSet,
                                paramsToUnset,
                                setParamsToUnset,
                                paramsToDelete,
                                setParamsToDelete,
                                actionLoading,
                                handleManageParamsSubmit,
                                openSnackbar,
                            }) => {
    const {t} = useTranslation();
    const listId = useId();
    // The text of the "add" field: a keyword when it names one, else free text.
    const [keywordInput, setKeywordInput] = useState("");

    const selectedKeyword = useMemo(() => {
        const text = keywordInput.trim();
        if (!text) return null;
        return (keywordsData || []).find((keyword) => keywordLabel(keyword) === text) || text;
    }, [keywordInput, keywordsData]);

    const existingKeywords = useMemo(() => {
        if (!existingParams) return [];
        return existingParams.map((param) => {
            const parts = param.keyword.split(".");
            return {
                section: parts.length > 1 ? parts[0] : "",
                option: parts.length > 1 ? parts.slice(1).join(".") : param.keyword,
                value: param.value,
            };
        });
    }, [existingParams]);

    const existingSections = useMemo(() => {
        if (!existingParams) return [];
        const sections = new Set(
            existingParams.map((param) => {
                const parts = param.keyword.split(".");
                return parts.length > 1 ? parts[0] : "";
            }).filter(Boolean)
        );
        return Array.from(sections);
    }, [existingParams]);

    const existingSectionSuffixes = useMemo(() => {
        const suffixMap = {};
        existingSections.forEach((section) => {
            const hashIndex = section.indexOf("#");
            if (hashIndex !== -1) {
                const prefix = section.substring(0, hashIndex);
                const suffix = section.substring(hashIndex + 1);
                if (!suffixMap[prefix]) suffixMap[prefix] = [];
                if (!suffixMap[prefix].includes(suffix)) suffixMap[prefix].push(suffix);
            }
        });
        return suffixMap;
    }, [existingSections]);

    const addParameter = () => {
        if (selectedKeyword) {
            if (typeof selectedKeyword === 'string') {
                openSnackbar(t("config.feedback.invalidParam", {name: selectedKeyword}), 'error');
                return;
            }
            const keywordSection = selectedKeyword.section || "";
            const hasSection = keywordSection && keywordSection !== "DEFAULT";
            if (hasSection) {
                const newParam = {
                    sectionPrefix: keywordSection,
                    sectionSuffix: "",
                    option: selectedKeyword.option,
                    value: "",
                    id: `${selectedKeyword.option}-${Date.now()}`,
                    keyword: {...selectedKeyword},
                };
                setParamsToSet([...paramsToSet, newParam]);
            } else {
                const newParam = {
                    section: "",
                    option: selectedKeyword.option,
                    value: "",
                    id: `${selectedKeyword.option}-${Date.now()}`,
                    keyword: {...selectedKeyword},
                };
                setParamsToSet([...paramsToSet, newParam]);
            }
            setKeywordInput("");
        }
    };

    const removeParameter = (index) => {
        const newParams = paramsToSet.filter((_, i) => i !== index);
        setParamsToSet(newParams);
    };

    const updateParamSection = (index, newSection) => {
        const updated = [...paramsToSet];
        updated[index].section = newSection;
        setParamsToSet(updated);
    };

    const updateParamSectionSuffix = (index, newSuffix) => {
        const updated = [...paramsToSet];
        updated[index].sectionSuffix = newSuffix;
        setParamsToSet(updated);
    };

    const updateParamValue = (index, newValue) => {
        const updated = [...paramsToSet];
        updated[index].value = newValue;
        setParamsToSet(updated);
    };

    const toggleUnset = (keyword) => {
        const label = keywordLabel(keyword);
        const selected = paramsToUnset.some((item) => keywordLabel(item) === label)
            ? paramsToUnset.filter((item) => keywordLabel(item) !== label)
            : [...paramsToUnset, keyword];
        setParamsToUnset(selected.map((item, index) => ({...item, id: `unset-${item.option}-${index}`})));
    };

    const toggleDelete = (section) => {
        setParamsToDelete(
            paramsToDelete.includes(section)
                ? paramsToDelete.filter((item) => item !== section)
                : [...paramsToDelete, section]
        );
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t("config.params.title")}
            size="lg"
            footer={
                <>
                    <Button onClick={onClose} disabled={actionLoading}>{t("common.cancel")}</Button>
                    <Button
                        onClick={handleManageParamsSubmit}
                        disabled={actionLoading}
                        icon={actionLoading ? <Spinner label={t("config.params.applying")}/> : undefined}
                    >
                        {t("config.params.apply")}
                    </Button>
                </>
            }
        >
            {(keywordsLoading || existingParamsLoading) && <Spinner/>}
            {keywordsError && <Alert>{keywordsError}</Alert>}
            {existingParamsError && <Alert>{existingParamsError}</Alert>}

            <section className="space-y-2">
                <h3 className="font-semibold">{t("config.params.addHeading")}</h3>
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <Field label={t("config.params.selectLabel")} hint={t("config.params.selectHint")}>
                            {(control) => (
                                <Input
                                    {...control}
                                    list={`${listId}-keywords`}
                                    placeholder={t("config.params.selectPlaceholder")}
                                    autoComplete="off"
                                    className="font-mono"
                                    value={keywordInput}
                                    onChange={(e) => setKeywordInput(e.target.value)}
                                    disabled={actionLoading || keywordsLoading}
                                />
                            )}
                        </Field>
                        <datalist id={`${listId}-keywords`}>
                            {(keywordsData || []).map((keyword, index) => (
                                <option key={`${keywordLabel(keyword)}-${index}`} value={keywordLabel(keyword)}/>
                            ))}
                        </datalist>
                    </div>
                    {/* Aligned with the field, above its hint. */}
                    <div className="mb-6">
                        <Button
                            icon={<PlusIcon/>}
                            onClick={addParameter}
                            disabled={!selectedKeyword || actionLoading}
                        >
                            {t("config.params.addButton")}
                        </Button>
                    </div>
                </div>

                {paramsToSet.length > 0 && (
                    <Table aria-label={t("config.params.tableLabel")}>
                        <thead>
                        <HeaderRow>
                            <HeaderCell className="w-1/4">{t("config.params.section")}</HeaderCell>
                            <HeaderCell>{t("config.params.parameter")}</HeaderCell>
                            <HeaderCell className="w-1/4">{t("config.params.value")}</HeaderCell>
                            <HeaderCell>{t("config.params.description")}</HeaderCell>
                            <HeaderCell><span className="sr-only">{t("common.actions")}</span></HeaderCell>
                        </HeaderRow>
                        </thead>
                        <tbody>
                        {paramsToSet.map((param, index) => {
                            const keyword = param.keyword;
                            const hasSectionPrefix = param.sectionPrefix !== undefined;
                            const sectionListId = `${listId}-sections-${index}`;
                            return (
                                <Row key={param.id}>
                                    <Cell>
                                        {hasSectionPrefix ? (
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className="font-mono whitespace-nowrap">{param.sectionPrefix}#</span>
                                                <Input
                                                    aria-label={t("config.params.index")}
                                                    list={sectionListId}
                                                    autoComplete="off"
                                                    placeholder={t("config.params.indexPlaceholder")}
                                                    className="h-7 font-mono"
                                                    value={param.sectionSuffix}
                                                    onChange={(e) => updateParamSectionSuffix(index, e.target.value)}
                                                    disabled={actionLoading}
                                                />
                                                <datalist id={sectionListId}>
                                                    {(existingSectionSuffixes[param.sectionPrefix] || []).map((suffix) => (
                                                        <option key={suffix} value={suffix}/>
                                                    ))}
                                                </datalist>
                                            </div>
                                        ) : (
                                            <>
                                                <Input
                                                    aria-label={t("config.params.sectionOptional")}
                                                    list={sectionListId}
                                                    autoComplete="off"
                                                    placeholder={t("config.params.sectionPlaceholder")}
                                                    className="h-7 font-mono"
                                                    value={param.section || ""}
                                                    onChange={(e) => updateParamSection(index, e.target.value)}
                                                    disabled={actionLoading}
                                                />
                                                <datalist id={sectionListId}>
                                                    {existingSections.map((section) => (
                                                        <option key={section} value={section}/>
                                                    ))}
                                                </datalist>
                                            </>
                                        )}
                                    </Cell>
                                    <Cell className="font-mono whitespace-nowrap" title={keyword?.text || ""}>
                                        {param.option}
                                    </Cell>
                                    <Cell>
                                        <Input
                                            aria-label={t("config.params.value")}
                                            className="h-7 font-mono"
                                            value={param.value}
                                            onChange={(e) => updateParamValue(index, e.target.value)}
                                            disabled={actionLoading}
                                        />
                                    </Cell>
                                    <Cell className="max-w-60 truncate text-ink-muted" title={keyword?.text || ""}>
                                        {keyword?.text || t("common.notAvailable")}
                                    </Cell>
                                    <Cell>
                                        <IconButton
                                            size="sm"
                                            label={t("config.params.removeParam")}
                                            onClick={() => removeParameter(index)}
                                            disabled={actionLoading}
                                        >
                                            <TrashIcon/>
                                        </IconButton>
                                    </Cell>
                                </Row>
                            );
                        })}
                        </tbody>
                    </Table>
                )}
            </section>

            <CheckboxGroup
                legend={t("config.params.unsetLegend")}
                hint={t("config.params.unsetHint")}
                emptyText={t("config.params.unsetEmpty")}
                choices={existingKeywords.map((keyword) => ({
                    key: keywordLabel(keyword),
                    label: keywordLabel(keyword),
                    value: keyword,
                }))}
                isChecked={(keyword) => paramsToUnset.some((item) => keywordLabel(item) === keywordLabel(keyword))}
                onToggle={toggleUnset}
                disabled={actionLoading || existingParamsLoading}
            />

            <CheckboxGroup
                legend={t("config.params.deleteLegend")}
                hint={t("config.params.deleteHint")}
                emptyText={t("config.params.deleteEmpty")}
                choices={existingSections.map((section) => ({key: section, label: section, value: section}))}
                isChecked={(section) => paramsToDelete.includes(section)}
                onToggle={toggleDelete}
                disabled={actionLoading || existingParamsLoading}
            />
        </Dialog>
    );
};

const ConfigSection = ({
                           decodedObjectName,
                           configNode,
                           setConfigNode,
                           openSnackbar,
                           configDialogOpen,
                           setConfigDialogOpen,
                           configRefreshTrigger = 0,
                           inline = false,
                           section = null,
                           absent: absentProp = false,
                       }) => {
    const {t} = useTranslation();
    // `absent`, the object has no configuration yet: the file starts empty, and the
    // first change written creates the object with it. Created, it is written as any.
    const [created, setCreated] = useState(false);
    const absent = absentProp && !created;
    // Secrets stay hidden until asked for, and hidden again each time the dialog opens.
    const [showSecrets, setShowSecrets] = useState(false);
    useEffect(() => {
        if (configDialogOpen) setShowSecrets(false);
    }, [configDialogOpen]);
    // Shown secrets are masked again on their own after a few seconds.
    const secondsLeft = useAutoHide(showSecrets, () => setShowSecrets(false));
    const {data: configData, loading: configLoading, error: configError, fetchConfig} = useConfig(
        decodedObjectName,
        configNode,
        setConfigNode,
        configRefreshTrigger,
        showSecrets,
    );
    const {
        data: keywordsData,
        loading: keywordsLoading,
        error: keywordsError,
        fetchKeywords
    } = useKeywords(decodedObjectName);
    const {
        data: existingParams,
        loading: existingParamsLoading,
        error: existingParamsError,
        fetchExistingParams,
    } = useExistingParams(decodedObjectName);

    const [updateConfigDialogOpen, setUpdateConfigDialogOpen] = useState(false);
    const [newConfigFile, setNewConfigFile] = useState(null);
    const [manageParamsDialogOpen, setManageParamsDialogOpen] = useState(false);
    const [paramsToSet, setParamsToSet] = useState([]);
    const [paramsToUnset, setParamsToUnset] = useState([]);
    const [paramsToDelete, setParamsToDelete] = useState([]);
    const [actionLoading, setActionLoading] = useState(false);

    // Direct edition of the file: `file` is the file the edit started from, `base`
    // the text edited as it started, `text` as edited: the whole file, or its
    // `section` alone. Kept when the dialog closes, so an edit is not lost to Escape.
    const [edit, setEdit] = useState(null);
    const [editLoading, setEditLoading] = useState(false);
    const [editError, setEditError] = useState(null);
    const [editConflict, setEditConflict] = useState(false);
    const editDirty = edit !== null && edit.text !== edit.base;

    const startEdit = async () => {
        // The shown text is redacted: written back, it would replace every secret
        // with asterisks. The edit starts from the file as stored.
        setShowSecrets(false);
        setEditError(null);
        setEditConflict(false);
        if (absent) {
            setEdit({file: "", base: "", text: ""});
            return;
        }
        setEditLoading(true);
        try {
            const file = await fetchRawConfigFile(decodedObjectName);
            const text = section === null ? file : extractSection(file, section) ?? `[${section}]\n`;
            setEdit({file, base: text, text});
        } catch (err) {
            setEditError(t("config.errors.fetchConfig", {message: err.message}));
        } finally {
            setEditLoading(false);
        }
    };

    const cancelEdit = () => {
        setEdit(null);
        setEditError(null);
        setEditConflict(false);
    };

    const saveEdit = async () => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setEditError(null);
        setEditConflict(false);
        setActionLoading(true);
        try {
            // The daemon writes the whole file: a change landed since the edit
            // started would be undone without a word.
            const current = absent ? "" : await fetchRawConfigFile(decodedObjectName);
            if (current !== edit.file) {
                setEditConflict(true);
                setEditError(t("config.feedback.conflict"));
                return;
            }
            const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file`, {
                // None yet: created with the file, an id of its own.
                method: absent ? "POST" : "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream",
                },
                // A section edited goes back in its place in the file as it was.
                body: absent ? withId(edit.text, newId()) : section === null ? edit.text : replaceSection(edit.file, section, edit.text),
            });
            // What came of it, the actions tray says; refused, the editor stays open and says why.
            const label = t(absent ? "actionTray.writes.configCreate" : "actionTray.writes.configFile");
            if (!response.ok) {
                if (response.status === 409) setEditConflict(true);
                const message = await problemMessage(response);
                const reason = message.startsWith("HTTP ") ? message : `HTTP ${response.status} ${message}`;
                trackRefused({action: "config", label, subject: decodedObjectName, reason});
                setEditError(t("config.feedback.updateFailed", {message}));
                return;
            }
            trackDone({action: "config", label, subject: decodedObjectName, path: decodedObjectName});
            if (absent) setCreated(true);
            setEdit(null);
            if (configNode) await fetchConfig(configNode, true);
        } catch (err) {
            trackRefused({action: "config", label: t("actionTray.writes.configFile"), subject: decodedObjectName, reason: err.message});
            setEditError(t("config.feedback.updateFailed", {message: err.message}));
        } finally {
            setActionLoading(false);
        }
    };

    const handleOpenManageParamsDialog = () => {
        setManageParamsDialogOpen(true);
        void fetchKeywords();
        // None yet: nothing set to read.
        if (!absent) void fetchExistingParams();
    };

    const handleUpdateConfig = async () => {
        /* istanbul ignore next */
        if (!newConfigFile) {
            openSnackbar(t("config.feedback.fileRequired"), "error");
            return;
        }
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setActionLoading(true);
        // What came of it, the actions tray says.
        const write = {action: "config", label: t(absent ? "actionTray.writes.configCreate" : "actionTray.writes.configFile"), subject: decodedObjectName, path: decodedObjectName};
        try {
            const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file`, {
                method: absent ? "POST" : "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/octet-stream",
                },
                body: absent ? withId(await newConfigFile.text(), newId()) : newConfigFile,
            });
            if (!(await trackWrite(response, write, refusal))) return;
            if (absent) setCreated(true);
            if (configNode) {
                await fetchConfig(configNode, true);
                setConfigDialogOpen(true);
            }
        } catch (err) {
            trackRefused({...write, reason: err.message});
        } finally {
            setActionLoading(false);
            setUpdateConfigDialogOpen(false);
            setNewConfigFile(null);
        }
    };

    /** A keyword set, unset or a section deleted, as the actions tray says it. */
    const write = (kind, values) => ({
        action: "config", label: t(`actionTray.writes.${kind}`, values), subject: decodedObjectName, path: decodedObjectName,
    });

    const handleAddParams = async () => {
        /* istanbul ignore next */
        if (!paramsToSet.length) {
            openSnackbar(t("config.feedback.paramRequired"), "error");
            return false;
        }
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return false;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setActionLoading(true);
        let successCount = 0;
        // None yet: the keywords set all at once, in the request creating it.
        const creating = [];
        for (const param of paramsToSet) {
            let fullKeyword;
            if (param.section !== undefined) {
                fullKeyword = param.section ? `${param.section}.${param.option}` : param.option;
            } else if (param.sectionPrefix !== undefined) {
                const section = param.sectionSuffix ? `${param.sectionPrefix}#${param.sectionSuffix}` : param.sectionPrefix;
                fullKeyword = section ? `${section}.${param.option}` : param.option;
            } else {
                /* istanbul ignore next */
                fullKeyword = param.option;
            }
            const {value, option} = param;
            const keyword = param.keyword;
            try {
                /* istanbul ignore next */
                if (!keyword) {
                    openSnackbar(t("config.feedback.invalidParam", {name: option}), "error");
                    continue;
                }
                if (keyword.converter === "converters.TListLowercase" && value.includes(",")) {
                    const values = value.split(",").map((v) => v.trim().toLowerCase());
                    if (values.some((v) => !v)) {
                        openSnackbar(t("config.feedback.invalidList", {keyword: fullKeyword}), "error");
                        continue;
                    }
                }
                if (absent) {
                    creating.push(`${fullKeyword}=${value}`);
                    continue;
                }
                const url = `${URL_OBJECT}/${namespace}/${kind}/${name}/config?set=${encodeURIComponent(fullKeyword)}=${encodeURIComponent(value)}`;
                const response = await fetch(url, {
                    method: "PATCH",
                    headers: {Authorization: `Bearer ${token}`},
                });
                if (await trackWrite(response, write("set", {keyword: fullKeyword, value}), refusal)) successCount++;
            } catch (err) {
                trackRefused({...write("set", {keyword: fullKeyword, value}), reason: err.message});
            }
        }
        if (creating.length > 0) {
            const created = write("configCreate");
            try {
                const query = creating.map((kw) => `set=${encodeURIComponent(kw)}`).join("&");
                const response = await fetch(`${URL_OBJECT}/${namespace}/${kind}/${name}/config/file?${query}`, {
                    method: "POST",
                    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream"},
                    body: withId("", newId()),
                });
                if (await trackWrite(response, created, refusal)) {
                    successCount += creating.length;
                    setCreated(true);
                }
            } catch (err) {
                trackRefused({...created, reason: err.message});
            }
        }
        if (successCount > 0) {
            if (configNode) {
                await fetchConfig(configNode, true);
                await fetchExistingParams();
                setConfigDialogOpen(true);
            }
        }
        setActionLoading(false);
        return successCount > 0;
    };

    const handleUnsetParams = async () => {
        if (!paramsToUnset.length) return false;
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return false;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setActionLoading(true);
        let successCount = 0;
        for (const param of paramsToUnset) {
            const {section, option} = param;
            try {
                /* istanbul ignore next */
                if (!option) {
                    openSnackbar(t("config.feedback.unsetErrorUnknown", {keyword: param.option || t("config.feedback.unknownParam")}), "error");
                    continue;
                }
                const fullKeyword = section ? `${section}.${option}` : option;
                const url = `${URL_OBJECT}/${namespace}/${kind}/${name}/config?unset=${encodeURIComponent(fullKeyword)}`;
                const response = await fetch(url, {
                    method: "PATCH",
                    headers: {Authorization: `Bearer ${token}`},
                });
                if (await trackWrite(response, write("unset", {keyword: fullKeyword}), refusal)) successCount++;
            } catch (err) {
                trackRefused({...write("unset", {keyword: section ? `${section}.${option}` : option}), reason: err.message});
            }
        }
        if (successCount > 0) {
            if (configNode) {
                await fetchConfig(configNode, true);
                await fetchExistingParams();
                setConfigDialogOpen(true);
            }
        }
        setActionLoading(false);
        return successCount > 0;
    };

    const handleDeleteParams = async () => {
        if (!paramsToDelete.length) return false;
        const token = localStorage.getItem("authToken");
        if (!token) {
            openSnackbar(t("config.feedback.tokenNotFound"), "error");
            return false;
        }
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        setActionLoading(true);
        let successCount = 0;
        for (const section of paramsToDelete) {
            try {
                const url = `${URL_OBJECT}/${namespace}/${kind}/${name}/config?delete=${encodeURIComponent(section)}`;
                const response = await fetch(url, {
                    method: "PATCH",
                    headers: {Authorization: `Bearer ${token}`},
                });
                if (await trackWrite(response, write("deleteSection", {section}), refusal)) successCount++;
            } catch (err) {
                trackRefused({...write("deleteSection", {section}), reason: err.message});
            }
        }
        if (successCount > 0) {
            if (configNode) {
                await fetchConfig(configNode, true);
                await fetchExistingParams();
                setConfigDialogOpen(true);
            }
        }
        setActionLoading(false);
        return successCount > 0;
    };

    const handleManageParamsSubmit = async () => {
        let anySuccess = false;
        if (paramsToSet.length) anySuccess = await handleAddParams() || anySuccess;
        if (paramsToUnset.length) anySuccess = await handleUnsetParams() || anySuccess;
        if (paramsToDelete.length) anySuccess = await handleDeleteParams() || anySuccess;
        if (!paramsToSet.length && !paramsToUnset.length && !paramsToDelete.length) {
            openSnackbar(t("config.feedback.noSelection"), "error");
            return;
        }
        if (anySuccess) {
            setParamsToSet([]);
            setParamsToUnset([]);
            setParamsToDelete([]);
            setManageParamsDialogOpen(false);
        }
    };

    const closeConfigDialog = () => setConfigDialogOpen(false);
    // The file, or its section alone.
    const shownText = configData === null || section === null ? configData : extractSection(configData, section);
    const keywordsPath = (() => {
        const {namespace, kind, name} = parseObjectPath(decodedObjectName);
        return [namespace, kind, name].map(encodeURIComponent).join("/");
    })();

    // The file, its tools and the edit in progress: in a dialog opened by a button,
    // or `inline`, in place, as in the configuration tab of an object.
    const body = edit ? (
                    <div className="space-y-2">
                        <p className="text-data text-ink-muted">
                            {t("config.view.editNotice")}
                        </p>
                        {editError && (
                            <Alert
                                action={editConflict && (
                                    <Button size="sm" onClick={startEdit} disabled={actionLoading || editLoading}>
                                        {t("config.view.startOver")}
                                    </Button>
                                )}
                            >
                                {editError}
                            </Alert>
                        )}
                        <Textarea
                            aria-label={t("config.view.fileLabel")}
                            value={edit.text}
                            onChange={(e) => setEdit({...edit, text: e.target.value})}
                            disabled={actionLoading}
                            spellCheck={false}
                            rows={Math.min(30, Math.max(10, edit.text.split("\n").length + 1))}
                            className="font-mono text-data whitespace-pre"
                        />
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-end gap-1">
                            {configData !== null && !configLoading && (
                                <p className="mr-auto text-data text-ink-muted">
                                    {showSecrets
                                        ? t("config.view.secretsMaskedIn", {time: formatSeconds(secondsLeft)})
                                        : t("config.view.secretsHidden")}
                                </p>
                            )}
                            {/* The text shown copied: its secrets masked unless shown. */}
                            {shownText !== null && !configLoading && (
                                <CopyButton size="md" text={shownText} label={t("config.view.copy")}/>
                            )}
                            {!absent && <IconButton
                                label={showSecrets ? t("config.view.hideSecrets") : t("config.view.showSecrets")}
                                aria-pressed={showSecrets}
                                onClick={() => setShowSecrets((shown) => !shown)}
                                disabled={configLoading}
                            >
                                {showSecrets ? <EyeOffIcon/> : <EyeIcon/>}
                            </IconButton>}
                            <IconButton
                                label={t("config.view.editFile")}
                                onClick={startEdit}
                                disabled={actionLoading || editLoading || (!configNode && !absent)}
                            >
                                {/* The file edited: the pencil. */}
                                <PencilIcon/>
                            </IconButton>
                            {/* The whole file uploaded, its parameters set: not from a section. */}
                            {section === null && (
                                <>
                                    <IconButton
                                        label={t("config.view.uploadFile")}
                                        onClick={() => setUpdateConfigDialogOpen(true)}
                                        disabled={actionLoading}
                                    >
                                        <UploadIcon/>
                                    </IconButton>
                                    <IconButton
                                        label={t("config.view.manageParams")}
                                        onClick={handleOpenManageParamsDialog}
                                        disabled={actionLoading}
                                    >
                                        {/* The parameters set one by one, in the wizard: the sliders. */}
                                        <SlidersIcon/>
                                    </IconButton>
                                </>
                            )}
                        </div>
                        {absent && <p className="text-ink-muted">{t("config.view.absent")}</p>}
                        {!absent && !configNode && !configLoading && !configError && (
                            <p className="text-ink-muted">{t("config.view.noInstance")}</p>
                        )}
                        {editLoading && <Spinner label={t("config.view.loadingForEdit")}/>}
                        {editError && !editLoading && <Alert>{editError}</Alert>}
                        {configLoading && <Spinner label={t("config.view.loading")}/>}
                        {configError && <Alert>{configError}</Alert>}
                        {!configLoading && !configError && configData === null && configNode && (
                            <p className="text-ink-muted">{t("config.view.empty")}</p>
                        )}
                        {!configLoading && !configError && configData !== null && shownText === null && (
                            <p className="text-ink-muted">{t("config.view.noSection", {section})}</p>
                        )}
                        {!configLoading && !configError && configData !== null && shownText !== null && (
                            <ConfigText
                                text={shownText}
                                label={t("config.view.fileLabel")}
                                keywordsUrl={`${URL_OBJECT}/${keywordsPath}/config/keywords`}
                                // The keywords are those of the kind: read once for all its objects.
                                cacheKey={`object:${parseObjectPath(decodedObjectName).kind}`}
                            />
                        )}
                    </>
                );
    const footer = (edit ? (
                    <>
                        <Button onClick={cancelEdit} disabled={actionLoading}>{t("common.cancel")}</Button>
                        <Button
                            onClick={saveEdit}
                            disabled={actionLoading || !editDirty}
                            icon={actionLoading ? <Spinner label={t("config.view.saving")}/> : undefined}
                        >
                            {t("common.save")}
                        </Button>
                    </>
                ) : (
                    <Button onClick={closeConfigDialog}>{t("common.close")}</Button>
                ));
    const subDialogs = (
        <>

            <UpdateConfigDialog
                open={updateConfigDialogOpen}
                onClose={() => setUpdateConfigDialogOpen(false)}
                newConfigFile={newConfigFile}
                setNewConfigFile={setNewConfigFile}
                actionLoading={actionLoading}
                handleUpdateConfig={handleUpdateConfig}
            />
            <ManageParamsDialog
                open={manageParamsDialogOpen}
                onClose={() => setManageParamsDialogOpen(false)}
                keywordsData={keywordsData}
                existingParams={absent ? [] : existingParams}
                keywordsLoading={keywordsLoading}
                existingParamsLoading={existingParamsLoading}
                keywordsError={keywordsError}
                existingParamsError={absent ? null : existingParamsError}
                paramsToSet={paramsToSet}
                setParamsToSet={setParamsToSet}
                paramsToUnset={paramsToUnset}
                setParamsToUnset={setParamsToUnset}
                paramsToDelete={paramsToDelete}
                setParamsToDelete={setParamsToDelete}
                actionLoading={actionLoading}
                handleManageParamsSubmit={handleManageParamsSubmit}
                openSnackbar={openSnackbar}
            />
        </>
    );

    if (inline) {
        return (
            <div className="space-y-2">
                {body}
                {edit && <div className="flex justify-end gap-2">{footer}</div>}
                {subDialogs}
            </div>
        );
    }

    return (
        <div className="inline-flex">
            <Button
                size="sm"
                icon={<FileIcon/>}
                onClick={() => setConfigDialogOpen(true)}
            >
                {t("config.view.button")}
            </Button>

            <Dialog
                open={configDialogOpen}
                onClose={closeConfigDialog}
                title={t("config.view.title")}
                size="lg"
                footer={footer}
            >
                {body}
            </Dialog>
            {subDialogs}
        </div>
    );
};

export default ConfigSection;
