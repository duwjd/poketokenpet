/**
 * Sign a release's checksum list, which is what lets the in-app updater
 * install it.
 *
 *   npm run release:keygen                    once, ever: make the key pair
 *   npm run release:sign -- 0.7.0             sign the v0.7.0 draft, upload the signature
 *   npm run release:sign -- 0.7.0 --publish   …and publish the draft
 *
 * ## Why the key lives here and not in CI
 *
 * The updater already checks every download against SHA256SUMS.txt. That
 * catches a broken download, and nothing else: the list sits on the same
 * release page as the zips, so whoever can replace a zip can replace the list
 * beside it. A signature only adds something if producing it takes a key the
 * release page's owner does not hold — and a key kept in Actions secrets is
 * held by anyone who can push a workflow, which is the same set of people.
 * So the private key stays on the maintainer's machine, and the one step that
 * needs it runs here, between CI drafting the release and Publish.
 *
 * The key file is never in the repo. Its default home is outside it, and
 * POKETOKENPET_SIGNING_KEY can point elsewhere (a mounted vault, say).
 */
import { execFileSync } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPO,
  SIG_NAME,
  SUMS_NAME,
  assetFor,
  latestFromSums,
  parseSums,
  verifySums,
} from '../electron/updatecore.ts';

const KEY =
  process.env.POKETOKENPET_SIGNING_KEY ||
  path.join(os.homedir(), '.config', 'poketokenpet', 'update-signing.pem');

/** Every zip some installed copy may ask for. A release missing one strands that machine. */
const MACHINES: [string, string][] = [
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['win32', 'x64'],
  ['win32', 'arm64'],
];

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function gh(args: string[]): string {
  try {
    return execFileSync('gh', [...args, '--repo', REPO], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch {
    return die(`gh ${args.slice(0, 2).join(' ')} 실패 — gh가 설치·로그인돼 있는지(gh auth status) 확인하세요.`);
  }
}

function keygen() {
  if (fs.existsSync(KEY)) {
    die(
      `이미 키가 있습니다: ${KEY}\n` +
        '  새로 만들면 지금까지 배포한 앱이 이후 릴리스를 설치하지 못합니다. 정말 바꾸려면\n' +
        '  docs/DEVELOPMENT.md의 "키를 잃어버렸거나 바꿔야 할 때"를 먼저 읽으세요.',
    );
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(KEY), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  console.log(`개인키: ${KEY}  (0600 — 저장소에 넣지 말고, 비밀번호 관리자 등에 따로 백업하세요)`);
  console.log(`공개키: ${pub}`);
  console.log('공개키를 electron/updatecore.ts의 UPDATE_PUBLIC_KEY에 넣으세요.');
}

function signRelease(version: string, publish: boolean) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) die(`버전은 0.7.0 같은 모양이어야 합니다: "${version}"`);
  if (!fs.existsSync(KEY)) die(`개인키가 없습니다: ${KEY}\n  처음이라면 npm run release:keygen`);
  const tag = `v${version}`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poketokenpet-sign-'));
  try {
    gh(['release', 'download', tag, '--pattern', SUMS_NAME, '--dir', dir]);
    // The exact bytes on the release page: the app verifies what it downloads,
    // so a re-encoded or re-wrapped copy would sign something nobody fetches.
    const bytes = fs.readFileSync(path.join(dir, SUMS_NAME));
    const sums = parseSums(bytes.toString('utf8'));

    const newest = latestFromSums(sums, 'darwin', 'arm64');
    if (newest?.version !== version) {
      die(`${SUMS_NAME}가 가리키는 버전이 ${newest?.version ?? '없음'}입니다 — ${version}이어야 합니다.`);
    }
    const missing = MACHINES.map(([p, a]) => assetFor(version, p, a)!).filter((n) => !sums.has(n));
    if (missing.length) die(`목록에 없는 파일이 있습니다: ${missing.join(', ')}\n  CI가 다 끝났는지 확인하세요.`);

    const signature = sign(null, bytes, createPrivateKey(fs.readFileSync(KEY))).toString('base64');
    // The app holds the public half. A key that does not match it would upload
    // a signature every installed copy rejects, so find out here instead.
    if (!verifySums(bytes, signature)) {
      die('이 개인키는 electron/updatecore.ts의 UPDATE_PUBLIC_KEY와 짝이 아닙니다.');
    }
    const sigFile = path.join(dir, SIG_NAME);
    fs.writeFileSync(sigFile, `${signature}\n`);
    gh(['release', 'upload', tag, sigFile, '--clobber']);
    console.log(`✓ ${tag}의 ${SUMS_NAME}에 서명해 ${SIG_NAME}를 올렸습니다.`);

    if (publish) {
      gh(['release', 'edit', tag, '--draft=false']);
      console.log(`✓ ${tag}를 공개했습니다. 설치된 앱들이 다음 확인 때 업데이트를 봅니다.`);
    } else {
      console.log('  릴리스 페이지에서 파일 목록을 확인한 뒤 Publish release를 누르세요.');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'keygen') keygen();
else if (cmd === 'sign' && rest[0]) signRelease(rest[0].replace(/^v/, ''), rest.includes('--publish'));
else die('사용법: npm run release:keygen | npm run release:sign -- <버전> [--publish]');
