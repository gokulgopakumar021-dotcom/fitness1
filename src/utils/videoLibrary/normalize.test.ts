import { describe, expect, it } from 'vitest';
import { equipmentFamilies, normalizeExerciseText, normalizeVideoFilename, slugifyExerciseName, tokenize } from './normalize';

describe('normalizeVideoFilename', () => {
  it('strips folders, extension, catalog numbers, separators and noise words', () => {
    const n = normalizeVideoFilename('Chest/0012_Barbell_Bench_Press_HD_video.MP4');
    expect(n.normalized).toBe('barbell bench press');
    expect(n.variant).toBeNull();
  });
  it('removes a separated trailing variant marker but keeps it for the report', () => {
    expect(normalizeVideoFilename('barbell-curl_2.mp4')).toMatchObject({ normalized: 'barbell curl', variant: '2' });
    expect(normalizeVideoFilename('Barbell Curl (1).mp4')).toMatchObject({ normalized: 'barbell curl', variant: '(1)' });
    expect(normalizeVideoFilename('barbell curl copy.mp4')).toMatchObject({ normalized: 'barbell curl', variant: 'copy' });
  });
  it('does not mangle numbers that belong to the name', () => {
    expect(normalizeVideoFilename('21s bicep curl.mp4').normalized).toBe('21s bicep curl');
    expect(normalizeVideoFilename('curl21.mp4').variant).toBeNull();
  });
  it('is case, punctuation and plural insensitive', () => {
    expect(normalizeExerciseText('Bicep  CURLS!')).toBe(normalizeExerciseText('bicep-curl'));
    expect(tokenize('Glutes & Abs')).toEqual(['glute', 'and', 'abs']);
  });
  it('keeps a readable title and handles an empty stem', () => {
    expect(normalizeVideoFilename('a_b.mp4').title).toBe('a b');
    expect(normalizeVideoFilename('.mp4').normalized).toBe('');
  });
});

describe('equipment and slugs', () => {
  it('maps equipment words to families', () => {
    expect([...equipmentFamilies(tokenize('EZ bar curl with dumbbell'))].sort()).toEqual(['barbell', 'dumbbell']);
  });
  it('slugifies names', () => {
    expect(slugifyExerciseName('Romanian Deadlift (RDL)')).toBe('romanian-deadlift-rdl');
  });
});
