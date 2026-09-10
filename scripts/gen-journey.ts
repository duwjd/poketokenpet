/**
 * Generator: builds src/journey.ts — the places the pet travels through.
 *
 * Run: npm run gen:journey
 *
 * ## Where the names come from, and why it is two sources
 *
 * PokeAPI carries every region and location, and it has KOREAN names for the
 * regions — all ten of them. For locations it does not: of 811 named places
 * (routes excluded) only 213 have a Korean name, and they are all in Hoenn,
 * Kalos and Alola. Kanto, Johto, Sinnoh, Unova, Galar, Hisui and Paldea have
 * none at all.
 *
 * Those seven are supplied by the table below, transcribed from the "In other
 * languages" row of each place's Bulbapedia article — which is the name the
 * Korean releases of the games actually print.
 *
 * ## Why that source, and what checked it
 *
 * The first forty-seven entries here were written and checked one at a time by
 * hand, and that mattered: a draft had New Bark Town as 무궁마을, which is
 * Cherrygrove — New Bark is 연두마을.
 *
 * Those forty-seven are now what VOUCHES for the rest. Re-derived from
 * Bulbapedia, thirty-five came back identical. The other twelve are corrections
 * this file was carrying: four were spacing (알프의유적 → 알프의 유적), and
 * eight were wrong outright —
 *
 *   sprout-tower   방울탑   → 모다피의 탑   (방울탑 is BELL Tower, a different building)
 *   cianwood-city  초옥시티 → 진청시티
 *   ilex-forest    뭉게숲   → 너도밤나무숲
 *   ice-path       얼음길   → 얼음샛길
 *   burned-tower   타버린탑 → 불탄탑
 *   national-park  국립공원 → 자연공원
 *   rock-tunnel    바위굴   → 돌산터널
 *   digletts-cave  디그다굴 → 디그다의 굴
 *
 * A source that reproduces thirty-five hand-checked names and repairs eight
 * mistakes is a better source than the hand-checking was. So the whole table
 * comes from it now, and the eight corrections are listed above rather than
 * quietly applied.
 *
 * **A place with no Korean name there is still left out.** It is better for the
 * journey to be short than for it to print a wrong name, and worse still an
 * English slug — `celadon-city` on a Korean caption is the failure this whole
 * arrangement exists to avoid. Forty-four places are missing for that reason,
 * most of them the Sevii Islands and the disambiguation-page names that are
 * shared across regions; `npm run gen:journey` prints the count per region.
 *
 * ## The order within a region
 *
 * PokeAPI stores Kanto and Johto alphabetically, and Sinnoh, Galar and Hisui in
 * no order that matches a playthrough — so leaning on upstream would open the
 * journey in Celadon. Kanto, Johto and Sinnoh therefore lead with the story
 * line as somebody walked it, written out by hand; everything after the blank
 * line in those three, and all of Unova, Galar, Hisui and Paldea, follows
 * upstream's own order. Kalos, Alola and Paldea are stored in game order
 * upstream, which is why they need nothing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://graphql.pokeapi.co/v1beta2';

/**
 * Encounters spent at one stop, written into the emitted file AND used for the
 * summary this prints. One constant, so the two cannot disagree — they did, and
 * the run reported a 58-day lap for a 35-day one.
 */
const LEG_LENGTH = 15;

/**
 * Travel order — the order the games came out in, which is also the order a
 * player would have walked them.
 *
 * `orre` is deliberately absent: it is a spin-off region and PokeAPI has no
 * Korean name for it, so it would print a slug.
 */
const REGION_ORDER = [
  'kanto', 'johto', 'hoenn', 'sinnoh', 'unova',
  'kalos', 'alola', 'galar', 'hisui', 'paldea',
] as const;

/**
 * Regions with no Korean place names anywhere yet.
 *
 * They are still fetched and still ordered above, so adding names below is all
 * it takes to bring one into the journey. Nothing else has to change.
 *
 * TODO: unova, galar, hisui, paldea — and the rest of sinnoh, which is only
 * partly filled in. Each needs its names checked against a source, one region
 * at a time, exactly as the three below were.
 */

/**
 * Korean names, checked by hand.
 *
 * Keyed by PokeAPI's own slug so the mapping is unambiguous — the slug is what
 * the fetch returns, and a typo here simply fails to match and drops the place
 * rather than mislabelling it.
 */
const HAND: Record<string, [string, string][]> = {
  // ── 관동 ── 42곳
  //
  // 앞의 20곳이 본편이 걷는 순서로 손수 적힌 줄기고, 그 뒤는 상류가 저장한
  // 순서다. 갈라지는 지점이 어디인지 알아볼 수 있게 비워 둔 줄로 나눠 뒀다.
  kanto: [
    ['pallet-town', '태초마을'],
    ['viridian-city', '상록시티'],
    ['viridian-forest', '상록숲'],
    ['pewter-city', '회색시티'],
    ['mt-moon', '달맞이산'],
    ['cerulean-city', '블루시티'],
    ['vermilion-city', '갈색시티'],
    ['digletts-cave', '디그다의 굴'],
    ['rock-tunnel', '돌산터널'],
    ['lavender-town', '보라타운'],
    ['pokemon-tower', '포켓몬타워'],
    ['celadon-city', '무지개시티'],
    ['kanto-power-plant', '무인발전소'],
    ['saffron-city', '노랑시티'],
    ['fuchsia-city', '연분홍시티'],
    ['kanto-safari-zone', '사파리존'],
    ['cinnabar-island', '홍련섬'],
    ['pokemon-mansion', '포켓몬저택'],
    ['seafoam-islands', '쌍둥이섬'],
    ['indigo-plateau', '석영고원'],

    ['cerulean-cave', '블루시티동굴'],
    ['kanto-victory-road-1', '챔피언로드'],
    ['kanto-victory-road-2', '챔피언로드'],
    ['monean-chamber', '이라님 석실'],
    ['liptoo-chamber', '이라님 석실'],
    ['weepth-chamber', '이라님 석실'],
    ['dilford-chamber', '이라님 석실'],
    ['scufib-chamber', '이라님 석실'],
    ['rixy-chamber', '이라님 석실'],
    ['ss-anne', '상트앙느호'],
    ['mt-ember', '등불산'],
    ['berry-forest', '열매 숲'],
    ['icefall-cave', '얼음폭포의 동굴'],
    ['pattern-bush', '증표의 숲'],
    ['kindle-road', '저녁노을길'],
    ['resort-gorgeous', '호화리조트'],
    ['memorial-pillar', '추억의 탑'],
    ['ruin-valley', '유적의 골짜기'],
    ['trainer-tower', '트레이너 타워'],
    ['tanoby-ruins', '옥포그리 유적'],
    ['birth-island', '탄생의 섬'],
    ['navel-rock', '배꼽바위'],

    // ── 아래는 상류에 한글명이 없어 손으로 채운 곳들. ※는 공식 한글판이
    //    없거나 확인되지 않아 통용명을 쓴 것이다. 헤더의 "통용명" 절 참고.
    ['viapos-chamber', '움노브리 석실'],  // ※
    ['lost-cave', '돌아올 수 없는 동굴'],  // ※
    ['treasure-beach', '보물만'],  // ※
    ['cape-brink', '곶 언저리'],  // ※
    ['bond-bridge', '유대의 다리'],  // ※
    ['three-isle-port', '3섬 항구'],  // ※
    ['water-labyrinth', '물의 미로'],  // ※
    ['five-isle-meadow', '5섬 공터'],  // ※
    ['outcast-island', '떨어진 섬'],  // ※
    ['green-path', '녹색 산책길'],  // ※
    ['water-path', '물의 산책길'],  // ※
    ['canyon-entrance', '계곡입구'],  // ※
    ['sevault-canyon', '칠보계곡'],  // ※
    ['one-island', '1섬'],  // ※
    ['four-island', '4섬'],  // ※
    ['five-island', '5섬'],  // ※
    ['two-island', '2섬'],  // ※
    ['three-island', '3섬'],  // ※
    ['three-isle-path', '3섬 터널'],  // ※
    ['six-island', '6섬'],  // ※
    ['seven-island', '7섬'],  // ※
    ['kanto-underground-path', '지하통로'],  // ※
  ],
  // ── 성도 ── 38곳
  //
  // 앞의 21곳이 본편이 걷는 순서로 손수 적힌 줄기고, 그 뒤는 상류가 저장한
  // 순서다. 갈라지는 지점이 어디인지 알아볼 수 있게 비워 둔 줄로 나눠 뒀다.
  johto: [
    ['new-bark-town', '연두마을'],
    ['cherrygrove-city', '무궁시티'],
    ['violet-city', '도라지시티'],
    ['sprout-tower', '모다피의 탑'],
    ['ruins-of-alph', '알프의 유적'],
    ['ilex-forest', '너도밤나무숲'],
    ['azalea-town', '고동마을'],
    ['dark-cave', '어둠의 동굴'],
    ['goldenrod-city', '금빛시티'],
    ['national-park', '자연공원'],
    ['ecruteak-city', '인주시티'],
    ['burned-tower', '불탄탑'],
    ['olivine-city', '담청시티'],
    ['cianwood-city', '진청시티'],
    ['mahogany-town', '황토마을'],
    ['lake-of-rage', '분노의 호수'],
    ['ice-path', '얼음샛길'],
    ['blackthorn-city', '검은먹시티'],
    ['dragons-den', '용의 굴'],
    ['whirl-islands', '소용돌이섬'],
    ['mt-silver', '은빛산'],

    ['mt-mortar', '절구산'],
    ['slowpoke-well', '야돈우물'],
    ['bell-tower', '방울탑'],
    ['tohjo-falls', '동성폭포'],
    ['union-cave', '연결동굴'],
    ['team-rocket-hq', '로켓단아지트'],
    ['goldenrod-tunnel', '금빛지하통로'],
    ['mt-silver-cave', '은빛 산'],
    ['pokeathlon-dome', '포켓슬론돔'],
    ['ss-aqua', '아쿠아호'],
    ['cliff-cave', '낭떠러지동굴'],
    ['frontier-access', '프런티어프런트'],
    ['bellchime-trail', '방울소리좁은길'],
    ['sinjoh-ruins', '신도유적'],
    ['embedded-tower', '매몰탑'],
    ['radio-tower', '금빛시티 라디오타워'],
    ['johto-safari-zone', '사파리존'],

    // ── 아래는 상류에 한글명이 없어 손으로 채운 곳들. ※는 공식 한글판이
    //    없거나 확인되지 않아 통용명을 쓴 것이다. 헤더의 "통용명" 절 참고.
    ['johto-lighthouse', '담청등대'],  // ※
  ],
  // ── 신오 ── 88곳
  //
  // 앞의 6곳이 본편이 걷는 순서로 손수 적힌 줄기고, 그 뒤는 상류가 저장한
  // 순서다. 갈라지는 지점이 어디인지 알아볼 수 있게 비워 둔 줄로 나눠 뒀다.
  sinnoh: [
    ['twinleaf-town', '떡잎마을'],
    ['jubilife-city', '축복시티'],
    ['oreburgh-city', '무쇠시티'],
    ['floaroma-town', '꽃향기마을'],
    ['eterna-city', '영원시티'],
    ['canalave-city', '운하시티'],

    ['pastoria-city', '들판시티'],
    ['sunyshore-city', '물가시티'],
    ['sinnoh-pokemon-league', '포켓몬 리그'],
    ['oreburgh-mine', '무쇠탄갱'],
    ['valley-windworks', '골짜기발전소'],
    ['eterna-forest', '영원의숲'],
    ['fuego-ironworks', '골풀무제철소'],
    ['mt-coronet', '천관산'],
    ['great-marsh', '대습초원'],
    ['solaceon-ruins', '신수유적'],
    ['sinnoh-victory-road', '챔피언로드'],
    ['ravaged-path', '험한 샛길'],
    ['stark-mountain', '하드마운틴'],
    ['spring-path', '숨겨진 샘의 길'],
    ['turnback-cave', '귀혼동굴'],
    ['snowpoint-temple', '선단신전'],
    ['wayward-cave', '미혹의 동굴'],
    ['ruin-maniac-cave', '유적마니아굴'],
    ['trophy-garden', '자랑의 뒷마당'],
    ['iron-island', '강철섬'],
    ['old-chateau', '숲의 양옥집'],
    ['lake-verity', '진실호수'],
    ['lake-valor', '입지호수'],
    ['lake-acuity', '예지호수'],
    ['valor-lakefront', '입지호수근처'],
    ['acuity-lakefront', '예지호수근처'],
    ['lost-tower', '로스트타워'],
    ['celestic-town', '봉신마을'],
    ['resort-area', '리조트에리어'],
    ['sandgem-town', '잔모래마을'],
    ['solaceon-town', '신수마을'],
    ['hearthome-city', '연고시티'],
    ['veilstone-city', '장막시티'],
    ['snowpoint-city', '선단시티'],
    ['spear-pillar', '창기둥'],
    ['pal-park', '팔파크'],
    ['amity-square', '상호교류광장'],
    ['floaroma-meadow', '꽃향기의 꽃밭'],
    ['fullmoon-island', '만월섬'],
    ['sendoff-spring', '송별의샘'],
    ['flower-paradise', '꽃의 낙원'],
    ['maniac-tunnel', '유적마니아굴'],
    ['galactic-hq', '갤럭시단아지트'],
    ['verity-lakefront', '진실호수근처'],
    ['newmoon-island', '신월섬'],
    ['sinnoh-battle-tower', '배틀타워'],
    ['fight-area', '파이트에리어'],
    ['survival-area', '서바이벌에리어'],
    ['seabreak-path', '갈라진 바닷길'],
    ['sinnoh-hall-of-origin-1', '시작의 방'],
    ['sinnoh-hall-of-origin-2', '시작의 방'],
    ['verity-cavern', '진실호수'],
    ['valor-cavern', '입지호수'],
    ['acuity-cavern', '예지호수'],
    ['jubilife-tv', '모두 두근두근'],
    ['gts', '글로벌 트레이드 스테이션'],
    ['mining-museum', '무쇠시티 탄갱박물관'],
    ['contest-hall', '콘테스트회장'],
    ['poffin-house', '포핀하우스'],
    ['sinnoh-foreign-building', '연고시티'],
    ['pokemon-day-care', '포켓몬키우미집'],
    ['sinnoh-game-corner', '게임코너'],
    ['canalave-library', '운하도서관'],
    ['vista-lighthouse', '길잡이등대'],
    ['sunyshore-market', '물가시장'],
    ['footstep-house', '발도장박사'],
    ['grand-lake', '호텔 그랜드레이크'],
    ['battle-park', '배틀파크'],
    ['battle-frontier', '배틀프런티어'],
    ['battle-factory', '배틀팩토리'],
    ['battle-castle', '배틀캐슬'],
    ['battle-arcade', '배틀룰렛'],
    ['battle-hall', '배틀스테이지'],
    ['distortion-world', '깨어진세계'],
    ['sinnoh-global-terminal', '글로벌 트레이드 스테이션'],
    ['sinnoh-villa', '별장'],
    ['battleground', '승부장소'],
    ['rotoms-room', '로토무의 방'],
    ['tg-eterna-bldg', '갤럭시단 영원시티 빌딩'],
    ['iron-ruins', '무쇠의 유적'],
    ['iceberg-ruins', '빙산의 유적'],
    ['rock-peak-ruins', '바위산의 유적'],

    // ── 아래는 상류에 한글명이 없어 손으로 채운 곳들. ※는 공식 한글판이
    //    없거나 확인되지 않아 통용명을 쓴 것이다. 헤더의 "통용명" 절 참고.
    ['poketch-co', '포켓치 컴퍼니'],  // ※
    ['trainers-school', '트레이너 스쿨'],  // ※
    ['sinnoh-flower-shop', '꽃집'],  // ※
    ['sinnoh-cycle-shop', '자전거숍'],  // ※
    ['veilstone-store', '장막백화점'],  // ※
    ['sinnoh-cafe', '카페'],  // ※
    ['sinnoh-restaurant', '레스토랑'],  // ※
  ],
  // ── 하나 ── 75곳
  unova: [
    ['nuvema-town', '마름꽃마을'],
    ['accumula-town', '넝쿨마을'],
    ['striaton-city', '성신시티'],
    ['nacrene-city', '칠보시티'],
    ['castelia-city', '구름시티'],
    ['nimbasa-city', '뇌문시티'],
    ['driftveil-city', '물풍경시티'],
    ['mistralton-city', '궐수시티'],
    ['icirrus-city', '설화시티'],
    ['opelucid-city', '쌍용시티'],
    ['dreamyard', '꿈터'],
    ['pinwheel-forest', '바람개비숲'],
    ['desert-resort', '리조트데저트'],
    ['relic-castle', '고대의 성'],
    ['cold-storage', '냉동컨테이너'],
    ['chargestone-cave', '전기돌동굴'],
    ['twist-mountain', '태엽산'],
    ['dragonspiral-tower', '용나선탑'],
    ['lacunosa-town', '보배마을'],
    ['undella-town', '물결마을'],
    ['anville-town', '가륜마을'],
    ['unova-pokemon-league', '포켓몬 리그'],
    ['royal-unova', '로열하나호'],
    ['gear-station', '배틀서브웨이'],
    ['battle-subway', '배틀서브웨이'],
    ['musical-theater', '포켓몬 뮤지컬'],
    ['black-city', '블랙시티'],
    ['white-forest', '화이트포리스트'],
    ['unity-tower', '유나이티드타워'],
    ['wellspring-cave', '지하수맥굴'],
    ['mistralton-cave', '궐수의 동굴'],
    ['rumination-field', '바람개비숲'],
    ['celestial-tower', '타워오브해븐'],
    ['moor-of-icirrus', '설화의 습지초원'],
    ['challengers-cave', '수행의 바위동굴'],
    ['poke-transfer-lab', '시프트팩토리'],
    ['giant-chasm', '자이언트홀'],
    ['liberty-garden', '리버티가든섬'],
    ['skyarrow-bridge', '스카이애로 브리지'],
    ['driftveil-drawbridge', '물풍경도개교'],
    ['tubeline-bridge', '실린더 브리지'],
    ['village-bridge', '빌리지 브리지'],
    ['marvelous-bridge', '원더 브리지'],
    ['entralink', '하일링크'],
    ['abundant-shrine', '풍요의 사당'],
    ['undella-bay', '물결만'],
    ['lostlorn-forest', '미혹의 숲'],
    ['trial-chamber', '챔피언로드'],
    ['guidance-chamber', '궐수의 동굴'],
    ['entree-forest', '하일링크'],
    ['abyssal-ruins', '해저유적'],
    ['aspertia-city', '부채시티'],
    ['virbank-city', '모란만시티'],
    ['humilau-city', '기하시티'],
    ['pokestar-studios', '포켓우드'],
    ['join-avenue', '조인애버뉴'],
    ['floccesy-town', '산가지마을'],
    ['lentimas-town', '산로마을'],
    ['castelia-sewers', '구름하수도'],
    ['floccesy-ranch', '산가지목장'],
    ['virbank-complex', '모란만콤비나트'],
    ['reversal-mountain', '리버스마운틴'],
    ['strange-house', '스트레인저하우스'],
    ['plasma-frigate', '플라스마프리깃'],
    ['relic-passage', '고대샛길'],
    ['clay-tunnel', '야콘로드'],
    ['white-treehollow', '백의 수동'],
    ['black-tower', '흑의 마천루'],
    ['seaside-cave', '해변동혈'],
    ['cave-of-being', '마음의동'],
    ['hidden-grotto', '은혈'],
    ['marine-tube', '마린튜브'],
    ['nature-sanctuary', '자연보호구역'],
    ['underground-ruins', '땅밑유적'],
    ['pledge-grove', '맹세의숲'],

    // ── 아래는 상류에 한글명이 없어 손으로 채운 곳들. ※는 공식 한글판이
    //    없거나 확인되지 않아 통용명을 쓴 것이다. 헤더의 "통용명" 절 참고.
    ['unova-victory-road', '챔피언로드'],  // ※
    ['ns-castle', 'N의 성'],  // ※
    ['unova-shopping-mall', '쇼핑몰 나인'],  // ※
    ['p2-laboratory', 'P2연구소'],  // ※
    ['unova-victory-road-2', '챔피언로드'],  // ※
    ['medal-secretariat', '메달사무국'],  // ※
    ['rocky-mountain-room', '바위산의 방'],  // ※
    ['glacier-room', '빙산의 방'],  // ※
    ['iron-room', '쇠철의 방'],  // ※
  ],
  // ── 가라르 ── 76곳
  galar: [
    ['axews-eye', '터검니호의 눈동자'],
    ['ballimere-lake', '볼레이크 호반'],
    ['ballonlea', '아라베스크마을'],
    ['galar-battle-tower', '배틀타워'],
    ['brawlers-cave', '파이트케이브'],
    ['bridge-field', '다리아래 벌판'],
    ['challenge-beach', '챌린지비치'],
    ['challenge-road', '챌린지로드'],
    ['circhester', '키르쿠스마을'],
    ['courageous-cavern', '투지의 동굴'],
    ['crown-shrine', '왕관신전'],
    ['dappled-grove', '햇살비추는숲'],
    ['dusty-bowl', '모래먼지구덩이'],
    ['dyna-tree-hill', '다이맥스나무 언덕'],
    ['east-lake-axewell', '터검니호 동쪽'],
    ['fields-of-honor', '인사의 들판'],
    ['forest-of-focus', '집중의 숲'],
    ['freezington', '프리즈마을'],
    ['frigid-sea', '얼어붙은 바다'],
    ['frostpoint-field', '빙점 설원'],
    ['galar-mine', '가라르광산'],
    ['galar-mine-no-2', '제2광산'],
    ['giants-bed', '거인의 침소'],
    ['giants-foot', '거인의 밑창'],
    ['giants-mirror', '거인의 거울 연못'],
    ['giants-seat', '거인의 의자'],
    ['glimwood-tangle', '루미너스메이즈숲'],
    ['hammerlocke', '너클시티'],
    ['hammerlocke-hills', '너클 구릉'],
    ['honeycalm-island', '허니컴섬'],
    ['honeycalm-sea', '허니컴 바다'],
    ['hulbury', '바우마을'],
    ['galar-iceberg-ruins', '빙산의 유적'],
    ['insular-sea', '외딴섬 해역'],
    ['galar-iron-ruins', '쇠철의 유적'],
    ['lake-of-outrage', '역린호수'],
    ['lakeside-cave', '호반 동굴'],
    ['loop-lagoon', '원환의 만'],
    ['master-dojo', '마스터 도장'],
    ['max-lair', '맥스다이맥스굴'],
    ['motostoke', '엔진시티'],
    ['motostoke-outskirts', '엔진시티 변두리'],
    ['motostoke-riverbank', '엔진 리버사이드'],
    ['north-lake-miloch', '밀로틱호 북쪽'],
    ['old-cemetery', '옛 무덤'],
    ['path-to-the-peak', '정상으로 가는 눈길'],
    ['postwick', '펄롱마을'],
    ['potbottom-desert', '냄비바닥사막'],
    ['roaring-sea-caves', '해명 동굴'],
    ['galar-rock-peak-ruins', '바위산의 유적'],
    ['rolling-fields', '화창한 초원'],
    ['slippery-slope', '출발의 설원'],
    ['slumbering-weald', '꾸벅졸음숲'],
    ['snowslide-slope', '설중 계곡'],
    ['soothing-wetlands', '청량한 습지초원'],
    ['south-lake-miloch', '밀로틱호 남쪽'],
    ['spikemuth', '스파이크마을'],
    ['split-decision-ruins', '결정의 유적'],
    ['stepping-stone-sea', '열도 바다'],
    ['stony-wilderness', '스톤즈들판'],
    ['stow-on-side', '래터럴마을'],
    ['three-point-pass', '세갈래 들판'],
    ['tower-of-darkness', '악의 탑'],
    ['tower-of-waters', '물의 탑'],
    ['training-lowlands', '단련 평원'],
    ['tunnel-to-the-top', '등정터널'],
    ['turffield', '터프마을'],
    ['warm-up-tunnel', '연습의 동굴'],
    ['watchtower-ruins', '감시탑 유적지'],
    ['wedgehurst', '브래시마을'],
    ['west-lake-axewell', '터검니호 서쪽'],
    ['workout-sea', '워크아웃 바다'],
    ['wyndon', '슛시티'],
    ['giants-cap', '거인의 모자'],
    ['energy-plant', '에너지플랜트'],
    ['meetup-spot', '모임의 공터'],

    // ── 아래는 상류에 한글명이 없어 손으로 채운 곳들. ※는 공식 한글판이
    //    없거나 확인되지 않아 통용명을 쓴 것이다. 헤더의 "통용명" 절 참고.
    ['steamdrift-way', '모락모락 좁은 길'],
    ['isle-of-armor-caves', '갑옷섬의 동굴들'],  // ※
    ['galar-wild-area-max-dens', '와일드에리어의 포켓몬 굴'],  // ※
  ],
  // ── 히스이 ── 87곳
  hisui: [
    ['aipom-hill', '에이팜산'],
    ['ancient-quarry', '고대의 채석장'],
    ['arenas-approach', '전장으로 가는 길'],
    ['aspiration-hill', '포부의 언덕'],
    ['avalanche-slopes', '눈사태 언덕'],
    ['avaluggs-legacy', '크레베이스 빙괴'],
    ['bathers-lagoon', '미역감기 석호'],
    ['bolderoll-ravine', '데굴데굴 산지'],
    ['bolderoll-slope', '데굴데굴 언덕'],
    ['bonechill-wastes', '극한의 황무지'],
    ['brava-arena', '무대의 전장'],
    ['castaway-shore', '미아의 바위해변'],
    ['celestica-ruins', '공신 사원터'],
    ['celestica-trail', '공신 산길'],
    ['clamberclaw-cliffs', '등반 절벽'],
    ['cloudcap-pass', '삿갓구름 산길'],
    ['cloudpool-ridge', '구름바다 고개'],
    ['cottonsedge-prairie', '황새풀 초원'],
    ['crossing-slope', '건넘의 비탈'],
    ['deadwood-haunt', '유령의 모래톱'],
    ['deertrack-heights', '큰뿔 고지'],
    ['deertrack-path', '큰뿔 산길'],
    ['diamond-heath', '금강부락 뒷산'],
    ['diamond-settlement', '금강부락'],
    ['droning-meadow', '날갯소리 들판'],
    ['fabled-spring', '페어리의 샘'],
    ['firespit-island', '불뿜는섬'],
    ['floaro-gardens', '꽃향기 개척지'],
    ['gapejaw-bog', '큰입 늪'],
    ['ginkgo-landing', '은행 해변'],
    ['glacier-terrace', '빙하 단구'],
    ['golden-lowlands', '금색 평야'],
    ['grandtree-arena', '거목의 전장'],
    ['grueling-grove', '험한 숲'],
    ['hearts-crag', '마음 바위산'],
    ['heavenward-lookout', '신전 고지'],
    ['hideaway-bay', '숨겨진 해변'],
    ['holm-of-trials', '시련의 모래톱'],
    ['horseshoe-plains', '편자 들판'],
    ['ice-column-chamber', '빙주의 방'],
    ['icebound-falls', '얼음귀신 폭포'],
    ['icepeak-arena', '빙산의 전장'],
    ['icepeak-cavern', '빙산 지하도'],
    ['islespy-shore', '섬줄기 해변'],
    ['jubilife-village', '축복마을'],
    ['hisui-lake-acuity', '예지호수'],
    ['hisui-lake-valor', '입지호수'],
    ['hisui-lake-verity', '진실호수'],
    ['lonely-spring', '외딴 용수'],
    ['lunkers-lair', '큰물고기의 암초'],
    ['molten-arena', '용암의 전장'],
    ['moonview-arena', '영월의 전장'],
    ['natures-pantry', '숲속 부엌'],
    ['obsidian-falls', '흑요 폭포'],
    ['oreburrow-tunnel', '무쇠터널'],
    ['pearl-settlement', '진주부락'],
    ['primeval-grotto', '태고의 동굴'],
    ['ramanas-island', '해당화섬'],
    ['sacred-plaza', '기도의 광장'],
    ['sands-reach', '모래손'],
    ['sandgem-flats', '잔모래 평원'],
    ['scarlet-bog', '진홍늪'],
    ['seagrass-haven', '해초의 낙원'],
    ['seaside-hollow', '바닷가 작은 굴'],
    ['shrouded-ruins', '안개의 유적'],
    ['sludge-mound', '진흙 대지'],
    ['snowfall-hot-spring', '설경 온천'],
    ['hisui-snowpoint-temple', '선단신전'],
    ['hisui-solaceon-ruins', '신수유적'],
    ['sonorous-path', '순례자의 길'],
    ['space-time-distortion', '시공의 뒤틀림'],
    ['hisui-spring-path', '숨겨진 샘의 길'],
    ['stonetooth-rows', '열석 고개'],
    ['temple-of-sinnoh', '신오신전'],
    ['the-heartwood', '안쪽 숲'],
    ['tidewater-dam', '하굿둑'],
    ['tombolo-walk', '톰볼로 길'],
    ['tranquility-cove', '고요한 내해'],
    ['hisui-turnback-cave', '귀혼동굴'],
    ['ursas-ring', '이탄 수련장'],
    ['veilstone-cape', '장막해안가'],
    ['hisui-wayward-cave', '미혹의 동굴'],
    ['wayward-wood', '미혹의 산림'],
    ['whiteout-valley', '폭설 골짜기'],
    ['windbreak-stand', '바람막이 숲'],
    ['windswept-run', '바람 샛길'],
    ['worn-bridge', '절삭다리'],

    // ── 아래는 상류에 한글명이 없어 손으로 채운 곳들. ※는 공식 한글판이
    //    없거나 확인되지 않아 통용명을 쓴 것이다. 헤더의 "통용명" 절 참고.
    ['coastlands-camp', '해안 베이스캠프'],  // ※
    ['heights-camp', '고지대 베이스캠프'],  // ※
  ],
  // ── 팔데아 ── 84곳
  paldea: [
    ['cabo-poco', '티스푼마을'],
    ['los-platos', '플라토마을'],
    ['mesagoza', '테이블시티'],
    ['cortondo', '세르클마을'],
    ['alfornada', '베이크마을'],
    ['pokemon-league', '포켓몬 리그'],
    ['artazon', '보울마을'],
    ['levincia', '누룩스시티'],
    ['zapapico', '피케마을'],
    ['cascarrafa', '카라프시티'],
    ['porto-marinada', '마리네이드마을'],
    ['medali', '참푸르마을'],
    ['montenevera', '프리지마을'],
    ['paldea-south-province-area-one', '남부 에리어 1'],
    ['paldea-south-province-area-two', '남부 에리어 2'],
    ['paldea-south-province-area-three', '남부 에리어 3'],
    ['paldea-south-province-area-four', '남부 에리어 4'],
    ['paldea-south-province-area-five', '남부 에리어 5'],
    ['paldea-south-province-area-six', '남부 에리어 6'],
    ['south-paldean-sea', '남팔데아해'],
    ['poco-path', '티스푼 오솔길'],
    ['inlet-grotto', '후미진 동굴'],
    ['naranja-academy', '오렌지 아카데미'],
    ['alfornada-cavern', '베이크 공동'],
    ['grasswither-shrine', '후목의 사당'],
    ['paldea-east-province-area-one', '동부 에리어 1'],
    ['paldea-east-province-area-two', '동부 에리어 2'],
    ['paldea-east-province-area-three', '동부 에리어 3'],
    ['east-paldean-sea', '동팔데아해'],
    ['tagtree-thicket', '표식의 나무숲'],
    ['schedar-squads-base', '팀 쉐다르 아지트'],
    ['navi-squads-base', '팀 시 아지트'],
    ['paldea-west-province-area-one', '서부 에리어 1'],
    ['paldea-west-province-area-two', '서부 에리어 2'],
    ['paldea-west-province-area-three', '서부 에리어 3'],
    ['asado-desert', '로스트 사막'],
    ['west-paldean-sea', '서팔데아해'],
    ['segin-squads-base', '팀 세긴 아지트'],
    ['icerend-shrine', '동파의 사당'],
    ['paldea-north-province-area-one', '북부 에리어 1'],
    ['paldea-north-province-area-two', '북부 에리어 2'],
    ['paldea-north-province-area-three', '북부 에리어 3'],
    ['casseroya-lake', '오야 호수'],
    ['dalizapa-passage', '푸르피케 산길'],
    ['glaseado-mountain', '나페산'],
    ['socarrat-trail', '누룽지 숲길'],
    ['groundblight-shrine', '진토의 사당'],
    ['firescourge-shrine', '화마의 사당'],
    ['north-paldean-sea', '북팔데아해'],
    ['ruchbah-squads-base', '팀 쉐다르 아지트'],
    ['caph-squads-base', '팀 카프 아지트'],
    ['area-zero', '에리어제로'],
    ['zero-lab', '제로랩'],
    ['uva-academy', '그레이프 아카데미'],
    ['apple-hills', '애플 힐스'],
    ['chilling-waterhead', '찬물 동굴'],
    ['crystal-pool', '태라수호'],
    ['dreaded-den', '공포의 굴'],
    ['fellhorn-gorge', '도깨비뿔 협곡'],
    ['infernal-pass', '지옥골'],
    ['kitakami-hall', '북신센터'],
    ['kitakami-road', '북신 가도'],
    ['kitakami-wilds', '북신 원생지'],
    ['loyalty-plaza', '세벗 플라자'],
    ['mossfell-confluence', '북신 합류지'],
    ['mossui-town', '스이록마을'],
    ['oni-mountain', '도깨비산'],
    ['onis-maw', '도깨비이빨 공동'],
    ['paradise-barrens', '낙원의 황무지'],
    ['revelers-road', '신명 산길'],
    ['timeless-woods', '영겁의 숲'],
    ['wistful-fields', '등꽃 들판'],
    ['canyon-biome', '캐니언 에리어'],
    ['canyon-plaza', '캐니언 스퀘어'],
    ['central-plaza', '센터 스퀘어'],
    ['chargestone-cavern', '전기돌의 암굴'],
    ['coastal-biome', '코스트 에리어'],
    ['coastal-plaza', '코스트 스퀘어'],
    ['league-club-room', '리그부'],
    ['polar-biome', '폴라 에리어'],
    ['polar-plaza', '폴라 스퀘어'],
    ['savanna-biome', '사바나 에리어'],
    ['savanna-plaza', '사바나 스퀘어'],
    ['torchlit-labyrinth', '등불의 미로'],
  ],
};

/**
 * Names for places in regions whose ORDER comes from upstream.
 *
 * Hoenn, Kalos and Alola walk in PokeAPI's own order, so they have no entry in
 * HAND — but PokeAPI still leaves a handful of their places unnamed. Those go
 * here: a name, and no claim about where in the region it falls.
 */
const EXTRA: Record<string, string> = {
  // ── 호연 ──
  'abandoned-ship': '버려진 배',
  'magma-hideout': '마그마단 아지트',  // ※
  'mirage-tower': '환영탑',
  'desert-underpass': '사막의 지하도',  // ※
  'artisan-cave': '아틀리에 굴',
  'underwater': '해저',  // ※
  'hoenn-battle-tower': '배틀타워',
  'terra-cave': '육지 동굴',  // ※
  'marine-cave': '바다 동굴',  // ※
  'faraway-island': '머나먼 고도',
  'hoenn-battle-frontier': '배틀프런티어',
  'mossdeep-space-center': '이끼 우주센터',
  'mirage-island': '환상섬',  // ※
  // ── 칼로스 ──
  'kalos-berry-fields': '나무열매밭',  // ※
  // ── 알로라 ──
  'hauoli-city': '하우올리시티',
  'verdant-cavern': '우거진 동굴',
  'thrifty-megamart': '로열 애버뉴',
  'malie-city': '말리에시티',
  'dividing-peak-tunnel': '경계터널',
  'heahea-beach': '환대비치',
  'sandy-cave': '해변 동굴',
  'ulaula-beach': '울라울라비치',
  'ultra-megalopolis': '울트라메가로폴리스',
  'ultra-space-wilds': '울트라스페이스제로',
  'poke-pelago': '포켓리조트',
  'team-rockets-castle': '로켓단의 성',
};

/** Flattened, for the lookup. The arrays above are the order; this is the map. */
const KO: Record<string, string> = { ...Object.fromEntries(Object.values(HAND).flat()), ...EXTRA };

/**
 * Places PokeAPI lists that are not places.
 *
 * Bookkeeping rows for roaming encounters, shop interiors and the Pokewalker.
 * They have slugs like anything else, so they have to be named to be excluded.
 *
 * `inside-of-truck` is the removal van the third generation opens inside. It
 * is the last thing in the whole route with no Korean name, and it was never
 * going to get one: it is a cutscene, not somewhere the pet can walk. Excluded
 * rather than left as the one line in the generator's report.
 */
const NOT_A_PLACE =
  /^(roaming-|unknown-)|pokemart|pokecenter|pokewalker|-gate$|altering-cave|mystery-zone|faraway-place|inside-of-truck/;

/**
 * Hoenn ships a location whose Korean name is literally "???".
 *
 * It is the mystery zone the games use for out-of-bounds encounters, and it has
 * a real localised name, so nothing above catches it — the name IS three
 * question marks. Left in, the caption reads "???를 지나는 중", which is the
 * same failure as printing a slug: a place the player cannot be.
 */
const NOT_A_NAME = /^\?+$/;

/**
 * Which sheet a place is walked on.
 *
 * Order matters — the first pattern that matches wins. That is the whole
 * design, and most of the entries below are here because of an order bug:
 * `ice-path` has to meet the ice rule before `path`, `frost-cavern` has to meet
 * it before `cave`, and `viridian-forest` has to meet `forest` before anything
 * else claims it. Everything unmatched is a plain field, the one sheet that
 * suits anywhere.
 *
 * This used to be five rules and it put 62 places — every cave, every mountain,
 * every ruin and every tower — on `stonepath`, which is a lawn-edged cobble
 * road. There are ten sheets now; see src/terrain.ts for why not more.
 */
const TERRAIN: [RegExp, string][] = [
  /**
   * The legendary rooms, before anything else can claim them.
   *
   * 시작의 방 · 창기둥 · 제단 · 하늘기둥 all fell through every rule below and
   * landed on `field` — Arceus's room was drawn as a meadow. They are summits
   * and altars, so they walk on mountain rock; `pillar`/`altar`/`기둥`/`제단`
   * has to be tested before `-town`/`시티` or 일륜의 제단 is a town.
   *
   * There is no dedicated art for any of them and there is not going to be:
   * PokeAPI's sprite repository has no places in it, and every Showdown
   * backdrop that is not one of the fifteen already used is either a
   * tournament banner or a whole battle screen with the HP plates and the
   * message box painted in. Fifteen scenery paintings used well beats a
   * sixteenth that fights the UI.
   */
  [/pillar|altar|hall-of-origin|기둥|제단|시작의 방|신전 고지/, 'mountain'],
  // Ice first, or 얼음길 matches `길` and becomes a road. There is no white
  // tileset in any CC0 pack that fits, so these walk on cave rock — which is
  // not a fallback: 얼음길 and 프로스트케이브 are both caves in the games. The
  // SKY table below is what makes them read as ICE caves.
  [/ice|snow|frost|glacier|얼음|프로스트|빙산|눈꽃/, 'cave'],
  [/forest|woods|jungle|나무|숲|밀림/, 'forest'],
  [/desert|dune|사막|모래/, 'desert'],
  [/cave|cavern|tunnel|grotto|굴$|동굴|땅굴|석실/, 'cave'],
  [/mt-|mount|volcano|plateau|peak|canyon|산$|산길|고원|화산|봉$/, 'mountain'],
  // `의 방`은 여기 있어야 한다: 땅밑유적의 세 방은 지하 석실이고, 시작의 방은 맨 위
  // 제단 규칙이 이미 가져갔으므로 여기까지 내려오지 않는다.
  [/ruins|tower|mansion|temple|chamber|shrine|room$|유적|탑$|저택|신전|사당|무덤|묘|의 방$/, 'ruins'],
  [/sea|island|beach|shore|bay|ocean|reef|섬$|바다|해변|해안|비치|물가|navel-rock|배꼽바위/, 'seaside'],
  [/lake|river|falls|water|marsh|spring|호수|호숫|폭포|늪|샘$/, 'lakeside'],
  [/meadow|garden|park|flower|공원|꽃|화원|정원/, 'flowers'],
  [/-city$|-town$|시티|마을|타운|도시/, 'town'],
  [/path|road|route|길$|가도|로드/, 'stonepath'],
];

/**
 * Which backdrop hangs at the horizon behind the walk.
 *
 * A SECOND, independent classification, and it is independent on purpose. The
 * terrain table above is capped by what CC0 pixel art exists — there is no
 * desert sheet and no snow sheet, so 사막 and 얼음길 fall back to field and
 * stonepath. The backdrops are Game Freak's Gen-5 battle art, fetched at
 * runtime and never committed (server/sprites.ts), so that shelf has a desert,
 * an ice cave and a volcano already paid for.
 *
 * Splitting the axes means a place gets the best answer each layer can give
 * rather than the worse of the two. 사막 walks on field and stands in front of
 * a desert; 얼음길 walks on cobble in front of an ice cave.
 *
 * Every value must be one of server/biome.ts's BG_SLUGS — it is interpolated
 * into a URL and a cache filename. A test holds that.
 */
const SKY: [RegExp, string][] = [
  /**
   * Two rules that had nowhere to point before.
   *
   * The summits and altars above were getting `null` — a flat sky behind the
   * most particular places on the route. And `deepsea` has sat in BG_SLUGS
   * since it was written, marked "real and reachable but nothing maps to it
   * yet"; 바다 동굴 is where Kyogre is, and the backdrop is a dark flooded
   * cavern with bubbles in it. It was waiting for exactly this.
   */
  [/pillar|altar|hall-of-origin|기둥|제단|시작의 방|신전 고지/, 'mountain'],
  [/underwater|abyssal|seafloor|marine-cave|해저|바다 동굴|심해/, 'deepsea'],
  [/ice|snow|frost|glacier|얼음|프로스트|빙산|눈꽃/, 'icecave'],
  [/volcano|magma|화산|용암/, 'volcanocave'],
  [/desert|dune|사막|모래/, 'desert'],
  [/forest|woods|jungle|나무|숲|밀림/, 'forest'],
  [/power-plant|발전소|공장/, 'thunderplains'],
  [/cave|cavern|tunnel|grotto|굴$|동굴|땅굴|석실/, 'dampcave'],
  [/mt-|mount|plateau|peak|canyon|산$|산길|고원|봉$/, 'mountain'],
  [/ruins|tower|mansion|temple|chamber|shrine|room$|유적|탑$|저택|신전|사당|무덤|묘|의 방$/, 'earthycave'],
  [/beach|shore|비치|해변|해안|물가/, 'beachshore'],
  [/sea|island|ocean|reef|섬$|바다|navel-rock|배꼽바위/, 'beach'],
  [/lake|river|falls|water|marsh|spring|호수|호숫|폭포|늪|샘$/, 'river'],
  [/meadow|garden|park|flower|공원|꽃|화원|정원/, 'meadow'],
  [/-city$|-town$|시티|마을|타운|도시/, 'city'],
];

/** Every slug SKY can produce. Emitted as a union so the renderer is typed. */
const SKY_IDS = [...new Set(SKY.map(([, id]) => id))].sort();

function matchFor(table: [RegExp, string][], slug: string, ko: string): string | null {
  for (const [re, id] of table) {
    if (re.test(slug) || re.test(ko)) return id;
  }
  return null;
}

function terrainFor(slug: string, ko: string): string {
  return matchFor(TERRAIN, slug, ko) ?? 'field';
}

/**
 * Null for anywhere with no obvious backdrop — a plain route, a laboratory.
 *
 * Null is not a failure path: it means the scene keeps the flat sky colour it
 * has always had, which is what an ordinary field should look like anyway.
 */
function skyFor(slug: string, ko: string): string | null {
  return matchFor(SKY, slug, ko);
}

type Loc = { name: string; region: { name: string } | null; locationnames: { name: string }[] };
type Reg = { name: string; regionnames: { name: string }[] };

async function main() {
  process.stdout.write('PokeAPI에서 지방·지명 가져오는 중... ');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{
        region(order_by: { id: asc }) {
          name
          regionnames(where: { language: { name: { _eq: "ko" } } }) { name }
        }
        location(order_by: { id: asc }) {
          name
          region { name }
          locationnames(where: { language: { name: { _eq: "ko" } } }) { name }
        }
      }`,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const json = (await res.json()) as { data: { region: Reg[]; location: Loc[] }; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const regionKo = new Map<string, string>();
  for (const r of json.data.region) {
    const ko = r.regionnames[0]?.name;
    if (ko) regionKo.set(r.name, ko);
  }
  for (const r of REGION_ORDER) {
    if (!regionKo.has(r)) throw new Error(`지방 한글명이 없습니다: ${r}`);
  }
  console.log(`지방 ${regionKo.size}개 · 지명 ${json.data.location.length}개`);

  /** Numbered routes are skipped: "1번도로" fifty times is not a journey. */
  const isRoute = (n: string) => /route-\d+$/.test(n);

  const stops: { ko: string; region: string; terrain: string; sky: string | null }[] = [];
  const dropped: Record<string, number> = {};
  /** Folded into an earlier stop of the same name — a different thing from unnamed. */
  const folded: Record<string, number> = {};
  /** The slugs still waiting for a name, listed so nobody has to go find them. */
  const unnamed: string[] = [];
  /**
   * Alola splits one place into several sub-areas that share a Korean name, so
   * PokeAPI hands back 하우올리시티 three times and 텐캐럿힐 twice. Walked
   * straight through, the caption says the same place for two hours, moves on,
   * and says it again — which reads as a stuck app, not a journey.
   *
   * Keyed by region as well as name because two regions really can share one:
   * 사파리존 is in both Kanto and Hoenn, and 챔피언로드 is in most of them.
   */
  const seen = new Set<string>();

  for (const region of REGION_ORDER) {
    const all = json.data.location.filter((l) => l.region?.name === region);
    /**
     * A region listed in HAND leads with the order it was written in; anything
     * upstream has that HAND does not mention follows.
     *
     * The tail is what makes this safe. HAND used to be a FILTER — only its own
     * entries walked — which was fine while it covered every named place in
     * those regions and silently dropped the rest the moment it did not. A
     * place PokeAPI adds later now joins the end of its region instead of
     * vanishing.
     */
    const order = HAND[region];
    const named = new Set(order?.map(([slug]) => slug) ?? []);
    const here = order
      ? [
          ...order.map(([slug]) => all.find((l) => l.name === slug)).filter((l): l is Loc => !!l),
          ...all.filter((l) => !named.has(l.name)),
        ]
      : all;
    let kept = 0;
    for (const l of here) {
      if (isRoute(l.name) || NOT_A_PLACE.test(l.name)) continue;
      // Hand-checked name first: PokeAPI's own is authoritative where it exists,
      // but an override is there because someone verified it.
      const ko = KO[l.name] ?? l.locationnames[0]?.name;
      if (!ko || NOT_A_NAME.test(ko)) {
        dropped[region] = (dropped[region] ?? 0) + 1;
        unnamed.push(`${region}/${l.name}`);
        continue;
      }
      const key = `${region}/${ko}`;
      if (seen.has(key)) {
        folded[region] = (folded[region] ?? 0) + 1;
        continue;
      }
      seen.add(key);
      stops.push({
        ko,
        region: regionKo.get(region)!,
        terrain: terrainFor(l.name, ko),
        sky: skyFor(l.name, ko),
      });
      kept++;
    }
    /**
     * Two different reasons a place does not become a stop, reported apart.
     *
     * They used to be one number labelled "한글명 없어 제외", which was wrong
     * for every region that folds duplicates: Kanto reported six missing names
     * when it had none — those six were the Unown chambers and the two Victory
     * Road halves collapsing into one caption each, which is the dedupe below
     * working exactly as intended. One number for two causes sent somebody
     * looking for names that were never missing.
     */
    const miss = dropped[region] ?? 0;
    const dup = folded[region] ?? 0;
    console.log(
      `   ${regionKo.get(region)!.padEnd(5)} ${String(kept).padStart(3)}곳` +
        (miss ? `  · 한글명 없음 ${miss}` : '') +
        (dup ? `  · 같은 이름으로 합침 ${dup}` : ''),
    );
  }

  if (!stops.length) throw new Error('여정에 넣을 지명이 하나도 없습니다');

  const byTerrain: Record<string, number> = {};
  const bySky: Record<string, number> = {};
  for (const s of stops) {
    byTerrain[s.terrain] = (byTerrain[s.terrain] ?? 0) + 1;
    bySky[s.sky ?? '(없음)'] = (bySky[s.sky ?? '(없음)'] ?? 0) + 1;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, '..', 'src', 'journey.ts');

  const body = `// GENERATED by scripts/gen-journey.ts — do not edit by hand.
// Source: PokeAPI (https://pokeapi.co) for regions and for Hoenn/Kalos/Alola
// place names; the rest are hand-checked in the generator. See that file.

import type { TerrainId } from './terrain.ts';

/**
 * Every backdrop the journey can ask for at the horizon.
 *
 * A subset of server/biome.ts's BG_SLUGS, which is the authority on what
 * actually exists upstream. Declared here rather than imported because this
 * file is renderer-side and that one is not — a test keeps the two in step.
 */
export type SkyId = ${SKY_IDS.map((id) => `'${id}'`).join(' | ')};

/**
 * One place on the journey, and the two independent things it looks like.
 *
 * \`terrain\` is which of the ten sheets gets painted underfoot. It is NOT what
 * the place is — a town and a stone road walk on the same cobble, and the
 * sheets have to cover ${stops.length} places between them.
 *
 * \`sky\` is the Gen-5 backdrop hung at the horizon, or null for nowhere in
 * particular. It is classified separately because the two layers have different
 * limits: sheets are capped by what CC0 art exists, backdrops are not, so a
 * desert can have a sky without having a floor.
 */
export type Stop = { ko: string; region: string; terrain: TerrainId; sky: SkyId | null };

export const STOPS: Stop[] = ${JSON.stringify(stops, null, 1)};

/**
 * Encounters spent at one stop before moving on.
 *
 * Hunting settles every five minutes, so this is an hour and a quarter at each
 * place. It was 25 — two hours — back when the route was 240 stops and a lap
 * came to about 21 days. The route is now nearly 700, and holding 25 would have
 * made one lap two months of continuous uptime and half a year at a realistic
 * eight hours a day. Fifteen puts a lap back around five weeks while still
 * leaving long enough at each place to notice it.
 */
export const LEG_LENGTH = ${LEG_LENGTH};

/**
 * Where the pet is, from how much hunting has happened.
 *
 * Derived, never stored — \`hunt.count\` only counts up, so this needs no schema
 * bump and cannot drift. Total by construction: a missing or nonsense count
 * reads as "just set out" rather than indexing off the end.
 */
export function journeyFor(huntCount: number): Stop {
  const n = Number.isFinite(huntCount) ? Math.max(0, Math.floor(huntCount)) : 0;
  return STOPS[Math.floor(n / LEG_LENGTH) % STOPS.length];
}
`;

  await fs.writeFile(out, body, 'utf8');
  console.log(`→ src/journey.ts`);
  // Twelve encounters an hour, around the clock. `LEG_LENGTH`, not a literal —
  // it read 58 days for a 35-day lap the moment the leg got shorter.
  console.log(
    `   ${stops.length}곳 · 한 바퀴 약 ${Math.round((stops.length * LEG_LENGTH) / 12 / 24)}일(연속 가동)`,
  );
  const tally = (t: Record<string, number>) =>
    Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`   지형 분포: ${tally(byTerrain)}`);
  console.log(`   배경 분포: ${tally(bySky)}`);
  const total = Object.values(dropped).reduce((a, b) => a + b, 0);
  if (total) {
    // Named, not just counted: the whole point of the number is that somebody
    // can go and fill them in, and a count sends them hunting for the list.
    console.log(`   한글명이 없어 뺀 곳 ${total} — KO 표를 채우면 들어옵니다:`);
    for (const u of unnamed) console.log(`     ${u}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
