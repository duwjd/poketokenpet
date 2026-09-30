import { describe, expect, it } from 'vitest';
import {
  assetFor,
  fallbackTarget,
  installTarget,
  isNewer,
  latestFromSums,
  macScript,
  parseSums,
  psQuote,
  shQuote,
  updatedFrom,
  winScript,
} from '../electron/updatecore.ts';

describe('isNewer', () => {
  it('compares numerically, not as strings', () => {
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('v0.4.1', '0.4.0')).toBe(true);
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true);
  });

  it('never offers the same version or an older one', () => {
    expect(isNewer('v0.4.0', '0.4.0')).toBe(false);
    expect(isNewer('v0.3.9', '0.4.0')).toBe(false);
  });

  it('treats a tag it cannot read as no update', () => {
    // A prerelease-looking tag or a typo must not start a download.
    expect(isNewer('v0.5.0-beta.1', '0.4.0')).toBe(false);
    expect(isNewer('latest', '0.4.0')).toBe(false);
  });
});

describe('assetFor', () => {
  // These names are electron-builder.yml's artifactName. If this test has to
  // change, every installed copy's updater just stopped finding its file.
  it('names the zip each machine needs', () => {
    expect(assetFor('v0.5.0', 'darwin', 'arm64')).toBe('PokeTokenPet-0.5.0-arm64-mac.zip');
    expect(assetFor('v0.5.0', 'darwin', 'x64')).toBe('PokeTokenPet-0.5.0-x64-mac.zip');
    expect(assetFor('0.5.0', 'win32', 'x64')).toBe('PokeTokenPet-0.5.0-x64-win.zip');
    expect(assetFor('0.5.0', 'win32', 'arm64')).toBe('PokeTokenPet-0.5.0-arm64-win.zip');
  });

  it('has nothing to swap in on Linux or an unknown arch', () => {
    expect(assetFor('0.5.0', 'linux', 'x64')).toBeNull();
    expect(assetFor('0.5.0', 'win32', 'ia32')).toBeNull();
  });
});

describe('parseSums', () => {
  it('reads the release job\'s shasum output', () => {
    const text = [
      'a286ea8eeba5d734448ad59388f6fda36d089818a16253a8cf849542ceeae25a  PokeTokenPet-0.4.0-arm64-mac.dmg',
      'BE3ED4298209488DB4CFC74A8BA02E7525F7051CC180F8872981270D50F014C0 *PokeTokenPet-0.4.0-arm64-mac.zip',
      '',
      'not a line',
    ].join('\r\n');
    const m = parseSums(text);
    expect(m.size).toBe(2);
    expect(m.get('PokeTokenPet-0.4.0-arm64-mac.zip')).toBe(
      'be3ed4298209488db4cfc74a8ba02e7525f7051cc180f8872981270d50f014c0',
    );
  });
});

describe('latestFromSums', () => {
  const sums = parseSums(
    [
      `${'a'.repeat(64)}  PokeTokenPet-0.5.0-arm64-mac.dmg`,
      `${'b'.repeat(64)}  PokeTokenPet-0.5.0-arm64-mac.zip`,
      `${'c'.repeat(64)}  PokeTokenPet-0.5.0-x64-win.zip`,
    ].join('\n'),
  );

  it('reads the version off the file names and picks this machine\'s zip', () => {
    expect(latestFromSums(sums, 'darwin', 'arm64')).toEqual({
      version: '0.5.0',
      asset: 'PokeTokenPet-0.5.0-arm64-mac.zip',
      sha256: 'b'.repeat(64),
    });
  });

  it('still names the version when this machine has no zip in the list', () => {
    // An Intel Mac against a release that shipped no x64 zip: announce it, and
    // let the button open the release page instead of downloading nothing.
    expect(latestFromSums(sums, 'darwin', 'x64')).toEqual({ version: '0.5.0', asset: null, sha256: null });
    expect(latestFromSums(sums, 'linux', 'x64')?.asset).toBeNull();
  });

  it('finds nothing in a list with no release files', () => {
    expect(latestFromSums(parseSums(''), 'darwin', 'arm64')).toBeNull();
  });
});

describe('installTarget', () => {
  it('finds the .app around the macOS binary', () => {
    expect(installTarget('/Applications/PokeTokenPet.app/Contents/MacOS/PokeTokenPet', 'darwin')).toBe(
      '/Applications/PokeTokenPet.app',
    );
  });

  it('refuses a translocated copy, which is gone on the next launch', () => {
    expect(
      installTarget(
        '/private/var/folders/x/AppTranslocation/ABC/d/PokeTokenPet.app/Contents/MacOS/PokeTokenPet',
        'darwin',
      ),
    ).toBeNull();
  });

  it('refuses a binary that is not inside a bundle', () => {
    expect(installTarget('/usr/local/bin/electron', 'darwin')).toBeNull();
  });

  it('uses the unpacked folder on Windows', () => {
    expect(installTarget('C:\\Users\\민지\\Desktop\\PokeTokenPet\\PokeTokenPet.exe', 'win32')).toBe(
      'C:\\Users\\민지\\Desktop\\PokeTokenPet',
    );
  });
});

describe('fallbackTarget', () => {
  it('lands in a per-user folder that needs no administrator', () => {
    expect(fallbackTarget('darwin', '/Users/a', undefined)).toBe('/Users/a/Applications/PokeTokenPet.app');
    expect(fallbackTarget('win32', 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Local')).toBe(
      'C:\\Users\\a\\AppData\\Local\\Programs\\PokeTokenPet',
    );
    expect(fallbackTarget('linux', '/home/a', undefined)).toBeNull();
  });
});

describe('the swap scripts', () => {
  const plan = {
    pid: 4242,
    source: "/tmp/w/new/PokeTokenPet.app",
    target: "/Users/o'brien/내 앱/PokeTokenPet.app",
    workDir: '/tmp/w',
    fromVersion: '0.4.0',
  };

  it('quotes paths so a space, an apostrophe or Hangul cannot break out', () => {
    expect(shQuote("o'brien")).toBe(`'o'\\''brien'`);
    expect(psQuote("o'brien")).toBe(`'o''brien'`);
    const sh = macScript(plan);
    expect(sh).toContain(shQuote(plan.target));
    expect(sh).not.toContain(`mv ${plan.target}`);
  });

  it('waits for the app, keeps the old copy until the new one is in, and always starts something', () => {
    const sh = macScript(plan);
    const lines = sh.split('\n');
    const wait = lines.findIndex((l) => l.includes('kill -0 4242'));
    const move = lines.findIndex((l) => l.includes('.old') && l.startsWith('if [ -e'));
    const copy = lines.findIndex((l) => l.startsWith('if ditto'));
    const open = lines.findIndex((l) => l.startsWith('open '));
    expect(wait).toBe(1);
    expect(wait).toBeLessThan(move);
    expect(move).toBeLessThan(copy);
    // Outside the if/else, so the old version starts if the copy failed.
    expect(open).toBeGreaterThan(lines.indexOf('fi'));
    expect(lines[open]).toContain('--updated-from=0.4.0');
  });

  it('never mirrors on Windows — the folder may hold other things', () => {
    const ps = winScript({
      ...plan,
      source: 'C:\\t\\new',
      target: "C:\\Users\\o'brien\\바탕 화면\\PokeTokenPet",
      workDir: 'C:\\t',
      exeName: 'PokeTokenPet.exe',
    });
    expect(ps).toContain('Wait-Process -Id 4242');
    expect(ps).toContain("$dst = 'C:\\Users\\o''brien\\바탕 화면\\PokeTokenPet'");
    expect(ps).toMatch(/robocopy \$src \$dst \/E /);
    expect(ps).not.toMatch(/\/MIR|\/PURGE/);
    expect(ps).toContain("Start-Process -FilePath $exe -ArgumentList '--updated-from=0.4.0'");
  });
});

describe('updatedFrom', () => {
  it('reads the flag the swap script passes to the new copy', () => {
    expect(updatedFrom(['/x/PokeTokenPet', '--updated-from=0.4.0'])).toBe('0.4.0');
    expect(updatedFrom(['/x/PokeTokenPet', '--hidden'])).toBeNull();
    expect(updatedFrom(['--updated-from=garbage'])).toBeNull();
  });
});
