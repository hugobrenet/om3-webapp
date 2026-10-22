import {describe, expect, test} from 'vitest';
import {extractSection, replaceSection} from '../configSections';

const FILE = '[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\n\n[app#1]\ntype = forking\n';

describe('extractSection', () => {
    test('the section, its header included, without the blank lines closing it', () => {
        expect(extractSection(FILE, 'fs#1')).toBe('[fs#1]\ntype = flag\n');
        expect(extractSection(FILE, 'app#1')).toBe('[app#1]\ntype = forking\n');
    });

    test('null for a section the file does not hold, or no file', () => {
        expect(extractSection(FILE, 'fs#2')).toBeNull();
        expect(extractSection(null, 'fs#1')).toBeNull();
    });
});

describe('replaceSection', () => {
    test('in its place, a blank line kept before the next section', () => {
        expect(replaceSection(FILE, 'fs#1', '[fs#1]\ntype = flag\nsize = 1G'))
            .toBe('[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\nsize = 1G\n\n[app#1]\ntype = forking\n');
    });

    test('the last section, the file ending on a newline', () => {
        expect(replaceSection(FILE, 'app#1', '[app#1]\ntype = simple\n\n\n'))
            .toBe('[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\n\n[app#1]\ntype = simple\n');
    });

    test('appended to a file without it', () => {
        expect(replaceSection('[DEFAULT]\nnodes = *\n', 'fs#1', '[fs#1]\ntype = flag'))
            .toBe('[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\n');
    });
});
