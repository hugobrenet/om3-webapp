import React, {useEffect, useRef, useState} from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import {FaPlus, FaRobot, FaStop, FaPaperPlane} from 'react-icons/fa';
import {useAuth} from '../context/AuthProvider.jsx';
import useFetchDaemonStatus from '../hooks/useFetchDaemonStatus.jsx';
import useAiAgent from '../hooks/useAiAgent.js';
import useAiChat from '../hooks/useAiChat.js';
import AiMarkdown from './AiMarkdown.jsx';

const AiChat = () => {
    const auth = useAuth();
    const {
        clusterId,
        clusterName,
        daemon,
        loading,
        error: statusError,
        fetchNodes,
    } = useFetchDaemonStatus();
    const {enabled, ready, configurationError, client} = useAiAgent({clusterId, daemon});
    const scope = JSON.stringify([auth.authChoice, auth.user, clusterId, daemon?.nodename]);
    const chat = useAiChat({client, ready, scope});
    const [draft, setDraft] = useState('');
    const [dialog, setDialog] = useState('');
    const [title, setTitle] = useState('');
    const transcript = useRef(null);
    const scrollAnchor = useRef(null);
    const busy = Boolean(chat.pending);
    const turning = chat.pending === 'turn';
    const promptTooLarge = new TextEncoder().encode(draft).length > 32 * 1024;

    useEffect(() => {
        if (enabled && auth.accessToken) void fetchNodes(auth.accessToken);
    }, [enabled, auth.authChoice, auth.accessToken, fetchNodes]);

    useEffect(() => {
        setDraft('');
        setDialog('');
        setTitle('');
    }, [scope, ready, chat.conversation?.id, chat.historyReady]);

    useEffect(() => {
        if (!transcript.current) return;
        const anchor = scrollAnchor.current;
        transcript.current.scrollTop =
            anchor && anchor.conversationId === chat.conversation?.id
                ? anchor.top + transcript.current.scrollHeight - anchor.height
                : transcript.current.scrollHeight;
        scrollAnchor.current = null;
    }, [chat.messages]);

    useEffect(() => {
        if (chat.pending !== 'history') scrollAnchor.current = null;
    }, [chat.pending]);

    const loadOlder = () => {
        if (busy || !transcript.current) return;
        scrollAnchor.current = {
            conversationId: chat.conversation?.id,
            top: transcript.current.scrollTop,
            height: transcript.current.scrollHeight,
        };
        void chat.loadOlderMessages();
    };

    const submit = (event) => {
        event.preventDefault();
        if (!ready || !chat.historyReady || busy || !draft.trim() || promptTooLarge) return;
        const prompt = draft;
        setDraft('');
        void chat.send(prompt);
    };

    const confirmDialog = async () => {
        const result =
            dialog === 'rename'
                ? await chat.renameConversation(title)
                : await chat.deleteConversation();
        if (result) setDialog('');
    };

    return (
        <Box
            sx={{
                p: {xs: 2, md: 3},
                bgcolor: 'background.paper',
                border: '2px solid',
                borderColor: 'divider',
                boxShadow: 3,
            }}
        >
            <Stack
                direction={{xs: 'column', sm: 'row'}}
                spacing={1}
                alignItems={{sm: 'center'}}
                justifyContent="space-between"
                sx={{mb: 3}}
            >
                <Typography variant="h4" component="h1">
                    <FaRobot aria-hidden="true" /> AI Assistant
                </Typography>
                {ready && (
                    <Chip
                        variant="outlined"
                        label={`${clusterName || 'Cluster'} · ${daemon.nodename}`}
                    />
                )}
            </Stack>
            {!enabled && (
                <Alert severity="info">
                    {configurationError || 'The AI agent is not configured for this webapp.'}
                </Alert>
            )}
            {enabled && !auth.accessToken && (
                <Alert severity="info">
                    An authenticated session is required to use the AI assistant.
                </Alert>
            )}
            {enabled && auth.accessToken && !ready && (
                <Alert
                    severity={statusError ? 'error' : 'info'}
                    action={
                        <Button
                            color="inherit"
                            disabled={loading || !auth.accessToken}
                            onClick={() => fetchNodes(auth.accessToken)}
                        >
                            Refresh status
                        </Button>
                    }
                >
                    {statusError ||
                        (loading
                            ? 'Loading cluster and node information…'
                            : 'Waiting for the cluster ID and daemon node.')}
                </Alert>
            )}
            {ready && (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {xs: '1fr', md: '260px minmax(0, 1fr)'},
                        gap: 2,
                    }}
                >
                    <Paper variant="outlined" sx={{p: 2, minWidth: 0}}>
                        <Typography variant="h6" component="h2" sx={{mb: 1}}>
                            Conversations
                        </Typography>
                        <Stack spacing={1}>
                            <Button
                                variant="contained"
                                startIcon={<FaPlus />}
                                disabled={busy}
                                onClick={() => chat.createConversation()}
                            >
                                New conversation
                            </Button>
                            <Button
                                variant="outlined"
                                disabled={busy}
                                onClick={() => chat.refreshConversations()}
                            >
                                Refresh conversations
                            </Button>
                        </Stack>
                        {chat.pending === 'loading' && (
                            <CircularProgress
                                size={24}
                                aria-label="Loading conversations"
                                sx={{mt: 2}}
                            />
                        )}
                        {!chat.conversations.length && !busy && (
                            <Typography color="text.secondary" variant="body2" sx={{mt: 2}}>
                                No conversations yet.
                            </Typography>
                        )}
                        <List
                            aria-label="Conversations"
                            sx={{maxHeight: {xs: 180, md: '55vh'}, overflowY: 'auto'}}
                        >
                            {chat.conversations.map((conversation) => (
                                <ListItemButton
                                    key={conversation.id}
                                    selected={conversation.id === chat.conversation?.id}
                                    disabled={busy}
                                    onClick={() => chat.resumeConversation(conversation.id)}
                                >
                                    <ListItemText
                                        primary={conversation.title || 'Untitled conversation'}
                                        primaryTypographyProps={{sx: {overflowWrap: 'anywhere'}}}
                                    />
                                </ListItemButton>
                            ))}
                        </List>
                    </Paper>
                    <Paper
                        variant="outlined"
                        sx={{display: 'flex', flexDirection: 'column', minWidth: 0}}
                    >
                        <Stack
                            direction={{xs: 'column', sm: 'row'}}
                            spacing={1}
                            alignItems={{sm: 'center'}}
                            justifyContent="space-between"
                            sx={{p: 2}}
                        >
                            <Typography variant="h6" component="h2" sx={{overflowWrap: 'anywhere'}}>
                                {chat.conversation?.title || 'Ask about your cluster'}
                            </Typography>
                            {chat.conversation && (
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        disabled={busy}
                                        onClick={() => {
                                            setTitle(chat.conversation.title || '');
                                            setDialog('rename');
                                        }}
                                    >
                                        Rename
                                    </Button>
                                    <Button
                                        color="error"
                                        disabled={busy}
                                        onClick={() => setDialog('delete')}
                                    >
                                        Delete
                                    </Button>
                                </Stack>
                            )}
                        </Stack>
                        <Divider />
                        {chat.resumed && (
                            <Alert severity="info" sx={{m: 2, mb: 0}}>
                                History shows completed exchanges only. Past tool activity and token
                                usage are not available.
                            </Alert>
                        )}
                        <Box
                            ref={transcript}
                            role="log"
                            aria-label="Conversation messages"
                            aria-live="polite"
                            aria-relevant="additions text"
                            sx={{
                                p: 2,
                                height: {xs: '45vh', md: '50vh'},
                                minHeight: 240,
                                overflowY: 'auto',
                            }}
                        >
                            {chat.historyCursor && (
                                <Button disabled={busy} onClick={loadOlder} sx={{mb: 2}}>
                                    {chat.pending === 'history'
                                        ? 'Loading earlier messages…'
                                        : 'Load earlier messages'}
                                </Button>
                            )}
                            {!chat.messages.length && (
                                <Typography color="text.secondary">
                                    {chat.pending === 'resuming'
                                        ? 'Loading saved messages…'
                                        : !chat.historyReady
                                          ? 'Select a conversation again or create a new one to continue.'
                                          : 'Send a prompt to start a conversation or continue the selected one.'}
                                </Typography>
                            )}
                            <Stack spacing={2}>
                                {chat.messages.map((message) => (
                                    <Box
                                        key={message.id}
                                        sx={{
                                            alignSelf:
                                                message.role === 'user' ? 'flex-end' : 'flex-start',
                                            maxWidth: '100%',
                                            width: 'fit-content',
                                            p: 2,
                                            bgcolor:
                                                message.role === 'user'
                                                    ? 'action.selected'
                                                    : 'background.default',
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                        }}
                                    >
                                        <Typography variant="subtitle2" sx={{mb: 0.5}}>
                                            {message.role === 'user' ? 'You' : 'Assistant'}
                                        </Typography>
                                        {message.text && message.role === 'assistant' && (
                                            <AiMarkdown text={message.text} />
                                        )}
                                        {message.text && message.role !== 'assistant' && (
                                            <Typography
                                                component="div"
                                                sx={{
                                                    whiteSpace: 'pre-wrap',
                                                    overflowWrap: 'anywhere',
                                                }}
                                            >
                                                {message.text}
                                            </Typography>
                                        )}
                                        {message.tools?.length > 0 && (
                                            <Box
                                                component="ul"
                                                aria-label="Tool activity"
                                                sx={{pl: 2.5, my: 1}}
                                            >
                                                {message.tools.map((tool) => (
                                                    <Typography
                                                        component="li"
                                                        key={tool.id}
                                                        variant="body2"
                                                        color={
                                                            tool.status === 'failed'
                                                                ? 'error.main'
                                                                : 'text.secondary'
                                                        }
                                                    >
                                                        {tool.name} — {tool.status}
                                                    </Typography>
                                                ))}
                                            </Box>
                                        )}
                                        {message.status === 'running' && (
                                            <Stack
                                                direction="row"
                                                spacing={1}
                                                alignItems="center"
                                                sx={{mt: 1}}
                                            >
                                                <CircularProgress size={14} />
                                                <Typography variant="caption">Working…</Typography>
                                            </Stack>
                                        )}
                                        {['stopped', 'failed'].includes(message.status) && (
                                            <Typography variant="caption" color="warning.main">
                                                Incomplete response — {message.status}. No automatic
                                                retry.
                                            </Typography>
                                        )}
                                        {typeof message.usage?.total_tokens === 'number' && (
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{display: 'block', mt: 1}}
                                            >
                                                Tokens: {message.usage.total_tokens}
                                            </Typography>
                                        )}
                                    </Box>
                                ))}
                            </Stack>
                        </Box>
                        {chat.error && (
                            <Alert severity="error" sx={{mx: 2, mb: 1}}>
                                {chat.error}
                            </Alert>
                        )}
                        {chat.notice && (
                            <Alert severity="info" sx={{mx: 2, mb: 1}}>
                                {chat.notice}
                            </Alert>
                        )}
                        <Divider />
                        <Box component="form" onSubmit={submit} sx={{p: 2}}>
                            <TextField
                                label="Message"
                                multiline
                                minRows={2}
                                maxRows={8}
                                fullWidth
                                value={draft}
                                disabled={busy || !chat.historyReady}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (
                                        event.key !== 'Enter' ||
                                        event.shiftKey ||
                                        event.nativeEvent.isComposing ||
                                        event.nativeEvent.keyCode === 229
                                    )
                                        return;
                                    event.preventDefault();
                                    submit(event);
                                }}
                                error={promptTooLarge}
                                helperText={
                                    promptTooLarge
                                        ? 'The prompt must not exceed 32 KiB.'
                                        : 'Enter to send; Shift+Enter for a new line. Uses your current cluster permissions.'
                                }
                            />
                            <Stack
                                direction="row"
                                spacing={1}
                                justifyContent="flex-end"
                                sx={{mt: 1}}
                            >
                                {turning && (
                                    <Button
                                        variant="outlined"
                                        color="error"
                                        startIcon={<FaStop />}
                                        onClick={chat.stop}
                                    >
                                        Stop
                                    </Button>
                                )}
                                <Button
                                    type="submit"
                                    variant="contained"
                                    startIcon={<FaPaperPlane />}
                                    disabled={
                                        busy ||
                                        !chat.historyReady ||
                                        !draft.trim() ||
                                        promptTooLarge
                                    }
                                >
                                    Send
                                </Button>
                            </Stack>
                        </Box>
                    </Paper>
                </Box>
            )}
            <Dialog
                open={ready && Boolean(dialog)}
                onClose={() => {
                    if (!busy) setDialog('');
                }}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>
                    {dialog === 'rename' ? 'Rename conversation' : 'Delete conversation'}
                </DialogTitle>
                <DialogContent>
                    {dialog === 'rename' ? (
                        <TextField
                            label="Conversation title"
                            fullWidth
                            autoFocus
                            value={title}
                            disabled={busy}
                            onChange={(event) => setTitle(event.target.value)}
                            helperText="Up to 80 Unicode characters."
                            sx={{mt: 1}}
                        />
                    ) : (
                        <Typography>
                            Delete this conversation and its stored context? This cannot be undone.
                        </Typography>
                    )}
                    {chat.error && (
                        <Alert severity="error" sx={{mt: 2}}>
                            {chat.error}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button disabled={busy} onClick={() => setDialog('')}>
                        Cancel
                    </Button>
                    <Button
                        disabled={busy || (dialog === 'rename' && !title.trim())}
                        color={dialog === 'delete' ? 'error' : 'primary'}
                        onClick={confirmDialog}
                    >
                        {dialog === 'rename' ? 'Save title' : 'Confirm deletion'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default AiChat;
