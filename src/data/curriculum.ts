import type { Lesson } from '../types'

export const hiragana = [
  ['あ','a'],['い','i'],['う','u'],['え','e'],['お','o'],
  ['か','ka'],['き','ki'],['く','ku'],['け','ke'],['こ','ko'],
  ['さ','sa'],['し','shi'],['す','su'],['せ','se'],['そ','so'],
  ['た','ta'],['ち','chi'],['つ','tsu'],['て','te'],['と','to'],
  ['な','na'],['に','ni'],['ぬ','nu'],['ね','ne'],['の','no'],
  ['は','ha'],['ひ','hi'],['ふ','fu'],['へ','he'],['ほ','ho'],
  ['ま','ma'],['み','mi'],['む','mu'],['め','me'],['も','mo'],
  ['や','ya'],['ゆ','yu'],['よ','yo'],['ら','ra'],['り','ri'],
  ['る','ru'],['れ','re'],['ろ','ro'],['わ','wa'],['を','wo'],['ん','n']
] as const

export const katakana = [
  ['ア','a'],['イ','i'],['ウ','u'],['エ','e'],['オ','o'],
  ['カ','ka'],['キ','ki'],['ク','ku'],['ケ','ke'],['コ','ko'],
  ['サ','sa'],['シ','shi'],['ス','su'],['セ','se'],['ソ','so'],
  ['タ','ta'],['チ','chi'],['ツ','tsu'],['テ','te'],['ト','to'],
  ['ナ','na'],['ニ','ni'],['ヌ','nu'],['ネ','ne'],['ノ','no'],
  ['ハ','ha'],['ヒ','hi'],['フ','fu'],['ヘ','he'],['ホ','ho'],
  ['マ','ma'],['ミ','mi'],['ム','mu'],['メ','me'],['モ','mo'],
  ['ヤ','ya'],['ユ','yu'],['ヨ','yo'],['ラ','ra'],['リ','ri'],
  ['ル','ru'],['レ','re'],['ロ','ro'],['ワ','wa'],['ヲ','wo'],['ン','n']
] as const

export const lessons: Lesson[] = [
  { id:'hira-1', stage:'유아', title:'히라가나 あ행', description:'문자와 あお・いえ・うえ 같은 단어를 함께 학습합니다.', duration:20 },
  { id:'hira-2', stage:'유아', title:'히라가나 か행', description:'문자와 かお・えき・あか 같은 단어를 함께 학습합니다.', duration:20 },
  { id:'hira-test', stage:'유아', title:'히라가나 100% 종합 평가', description:'단일 문자, 듣기, 단어 읽기를 종합 평가합니다.', duration:20 },
  { id:'kata-1', stage:'유아', title:'가타카나 ア행', description:'문자와 アイス・カメラ 같은 외래어를 배웁니다.', duration:20, lockedBy:'hiragana' },
  { id:'kata-test', stage:'유아', title:'가타카나 100% 종합 평가', description:'장음과 작은 ッ까지 포함해 평가합니다.', duration:20, lockedBy:'hiragana' },
  { id:'grade1-1', stage:'초등학교 1학년', title:'これは何ですか？', description:'これ・それ・あれ와 기본 명사문을 배웁니다.', duration:20, lockedBy:'katakana' },
  { id:'grade1-2', stage:'초등학교 1학년', title:'조사 は・に・で', description:'주제, 이동 장소, 행동 장소를 구분합니다.', duration:20, lockedBy:'grade1-1' },
  { id:'grade2-1', stage:'초등학교 2학년', title:'동사 현재·과거', description:'갑니다·갔습니다·가지 않습니다를 배웁니다.', duration:20, lockedBy:'grade1-2' },
  { id:'grade3-1', stage:'초등학교 3학년', title:'て형과 부탁', description:'〜てください와 〜てもいいです를 연습합니다.', duration:20, lockedBy:'grade2-1' },
  { id:'middle-1', stage:'중학교', title:'병원에 전화하기', description:'증상 설명과 예약 변경을 역할극으로 연습합니다.', duration:20, lockedBy:'grade3-1' },
  { id:'high-1', stage:'고등학교', title:'실제 영상 대본 분석', description:'자유 라이선스 영상의 표현과 문법을 분석합니다.', duration:20, lockedBy:'middle-1' },
  { id:'adult-1', stage:'성인 생활 일본어', title:'일본 생활 종합 시뮬레이션', description:'부동산·병원·은행·직장 상황을 해결합니다.', duration:20, lockedBy:'high-1' },
]
