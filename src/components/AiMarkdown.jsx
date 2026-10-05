import React, {memo} from 'react';
import {Box, Link} from '@mui/material';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const elements = [
    'p',
    'strong',
    'em',
    'del',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'hr',
    'br',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
];

// Model text is untrusted. Only explicit web links are navigable, never
// relative URLs, protocol-relative URLs or URLs containing credentials.
const safeUrl = (value) => {
    if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return '';
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
        return url.href;
    } catch {
        return '';
    }
};

const components = {
    a: ({href, children}) =>
        href ? (
            <Link href={href} target="_blank" rel="noopener noreferrer">
                {children}
            </Link>
        ) : (
            <span>{children}</span>
        ),
    table: ({children}) => (
        <Box sx={{overflowX: 'auto', my: 1.5}}>
            <table>{children}</table>
        </Box>
    ),
};

const AiMarkdown = memo(function AiMarkdown({text}) {
    return (
        <Box
            sx={{
                typography: 'body1',
                overflowWrap: 'anywhere',
                '& > :first-child': {mt: 0},
                '& > :last-child': {mb: 0},
                '& p, & ul, & ol': {my: 1},
                '& h1, & h2': {fontSize: '1.25rem', mt: 2, mb: 1},
                '& h3, & h4, & h5, & h6': {fontSize: '1rem', mt: 2, mb: 1},
                '& ul, & ol': {pl: 3},
                '& code': {fontFamily: 'monospace', bgcolor: 'action.hover', borderRadius: 0.5},
                '& pre': {
                    p: 1.5,
                    overflowX: 'auto',
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    whiteSpace: 'pre',
                },
                '& pre code': {bgcolor: 'transparent'},
                '& blockquote': {ml: 0, pl: 2, borderLeft: '3px solid', borderColor: 'divider'},
                '& table': {borderCollapse: 'collapse', width: '100%'},
                '& th, & td': {
                    border: '1px solid',
                    borderColor: 'divider',
                    p: 1,
                    textAlign: 'left',
                },
                '& th': {bgcolor: 'action.hover'},
                '& hr': {border: 0, borderTop: '1px solid', borderColor: 'divider'},
            }}
        >
            <Markdown
                skipHtml
                allowedElements={elements}
                remarkPlugins={plugins}
                urlTransform={safeUrl}
                components={components}
            >
                {text}
            </Markdown>
        </Box>
    );
});

export default AiMarkdown;
