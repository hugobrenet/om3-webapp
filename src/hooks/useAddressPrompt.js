import {useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
import {linkPrompt} from '../config/ai-agent.js';
import {useSharedAiChat} from '../context/AiChatContext.js';

/**
 * The question an address opens the page of the assistant with (`prompt`, from
 * AskAssistantLink clicked with a modifier, or typed), bounded: asked of the
 * chat the application holds, which puts it in the message box of a new
 * conversation, then taken out of the address, so that a reload or a return to
 * the page does not put it there again. The other parameters stay.
 */
export default function useAddressPrompt() {
    const [searchParams, setSearchParams] = useSearchParams();
    const prompt = linkPrompt(searchParams.get('prompt'));
    const ask = useSharedAiChat()?.ask;
    useEffect(() => {
        if (!prompt) return;
        ask?.(prompt);
        setSearchParams((params) => {
            params.delete('prompt');
            return params;
        }, {replace: true});
    }, [prompt, ask, setSearchParams]);
}
