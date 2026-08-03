import { useEffect, useMemo, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { hiragana, katakana, lessons } from './data/curriculum'
import { placementQuestions } from './data/placement'
import { auth } from './lib/firebase'
import { readLearner, saveLearner } from './lib/storage'
import type { HomeworkProblem, Learner, LevelName, MasteryRecord, WrongAnswer } from './types'

type View = 'home' | 'today' | 'conversation' | 'course' | 'kana' | 'homework' | 'review' | 'video'
type KanaType = 'hiragana' | 'katakana'
type KanaPair = readonly [string, string]

const levels: LevelName[] = [
  '영유아','유아','초등학교 1학년','초등학교 2학년','초등학교 3학년',
  '초등학교 4학년','초등학교 5학년','초등학교 6학년','중학교','고등학교','성인 생활 일본어'
]

const hiraWords = [
  ['あお','파랑'],['いえ','집'],['うえ','위'],['えき','역'],['かお','얼굴'],
  ['あか','빨강'],['すし','초밥'],['かさ','우산'],['ねこ','고양이'],['いぬ','개'],
  ['はな','꽃'],['ひと','사람'],['みみ','귀'],['やま','산'],['ゆき','눈'],
  ['よる','밤'],['そら','하늘'],['わたし','나'],['ほん','책'],['くるま','자동차']
] as const

function nameToEmail(name:string){
  const bytes = new TextEncoder().encode(name.trim().toLowerCase())
  const hex = Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('')
  return `u${hex}@kotonoha.study`
}
function pinToPassword(pin:string){ return `Kt!${pin}#2026` }
function emptyMastery(items:readonly KanaPair[]){
  return Object.fromEntries(items.map(([char])=>[char,{correct:0,wrong:0,mastery:0,lastReviewedAt:null}]))
}
function createLearner(uid:string,name:string):Learner{
  return {
    id:uid,name,level:'미진단',placementDone:false,placementScore:0,
    hiraPassed:false,kataPassed:false,completedLessons:[],homework:null,
    streak:0,lastStudyDate:null,hiraganaMastery:emptyMastery(hiragana),
    katakanaMastery:emptyMastery(katakana),hiraganaPassCount:0,katakanaPassCount:0,latestFeedback:null,wrongAnswers:[],lessonDay:1,katakanaAdvanceChoice:null
  }
}
function hydrateLearner(raw:Learner):Learner{
  return {
    ...createLearner(raw.id,raw.name),
    ...raw,
    hiraganaMastery:{...emptyMastery(hiragana),...(raw.hiraganaMastery||{})},
    katakanaMastery:{...emptyMastery(katakana),...(raw.katakanaMastery||{})},
    hiraganaPassCount:raw.hiraganaPassCount||0,
    katakanaPassCount:raw.katakanaPassCount||0,
    latestFeedback:raw.latestFeedback||null,
    wrongAnswers:raw.wrongAnswers||[],
    lessonDay:raw.lessonDay||1,
    katakanaAdvanceChoice:raw.katakanaAdvanceChoice||null,
  }
}
function today(){ return new Date().toISOString().slice(0,10) }
function touched(learner:Learner):Learner{
  const date=today()
  if(learner.lastStudyDate===date)return learner
  let streak=1
  if(learner.lastStudyDate){
    const diff=Math.round((new Date(date).getTime()-new Date(learner.lastStudyDate).getTime())/86400000)
    streak=diff===1?learner.streak+1:1
  }
  return {...learner,lastStudyDate:date,streak}
}
type VoiceSpeed = 'slow' | 'normal' | 'natural'

const VOICE_NAME_KEY='kotonoha.voiceName'
const VOICE_SPEED_KEY='kotonoha.voiceSpeed'

function japaneseVoices(){
  if(!('speechSynthesis' in window))return []
  return window.speechSynthesis.getVoices().filter(voice=>
    voice.lang.toLowerCase().startsWith('ja')
  )
}

function preferredJapaneseVoice(){
  const voices=japaneseVoices()
  const saved=localStorage.getItem(VOICE_NAME_KEY)
  if(saved){
    const selected=voices.find(voice=>voice.name===saved)
    if(selected)return selected
  }

  const preferredNames=[
    'Kyoko','Otoya','Hattori','Nanami',
    'Google 日本語','Microsoft Nanami',
    'Japanese Japan'
  ]

  return preferredNames
    .map(name=>voices.find(voice=>voice.name.includes(name)))
    .find(Boolean) || voices.find(voice=>voice.localService) || voices[0]
}

function currentVoiceSpeed():VoiceSpeed{
  const saved=localStorage.getItem(VOICE_SPEED_KEY)
  return saved==='slow'||saved==='normal'||saved==='natural'?saved:'natural'
}

function speak(text:string,kind:'character'|'sentence'='sentence'){
  if(!('speechSynthesis' in window))return

  const clean=text.replace(/\s+/g,'').trim()
  const utterance=new SpeechSynthesisUtterance(text)
  const voice=preferredJapaneseVoice()
  const speed=currentVoiceSpeed()

  utterance.lang='ja-JP'
  if(voice)utterance.voice=voice

  const isShort=kind==='character'||Array.from(clean).length<=2
  if(isShort){
    utterance.rate=.68
    utterance.pitch=1
  }else{
    utterance.rate=speed==='slow'?.72:speed==='normal'?.86:.96
    utterance.pitch=.98
  }

  utterance.volume=1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

function teacherCorrectionMessage(input:string,answer:string){
  const typed=normalizeJapanese(input)
  const correct=normalizeJapanese(answer)

  if(!typed)return '괜찮아요. 정답을 보면서 천천히 다시 입력해볼까요?'
  if(correct.startsWith(typed))return '아주 좋아요. 앞부분은 정확해요. 뒤에 빠진 표현만 이어서 확인해볼까요?'
  if(typed.length>=correct.length-2)return '거의 완성했어요. 한두 글자만 다시 확인하면 됩니다.'
  return '좋은 시도예요. 히라가나 정답을 먼저 읽고 다시 한번 입력해볼까요?'
}

function JapaneseVoiceSettings(){
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([])
  const [voiceName,setVoiceName]=useState(localStorage.getItem(VOICE_NAME_KEY)||'')
  const [speed,setSpeed]=useState<VoiceSpeed>(currentVoiceSpeed())

  useEffect(()=>{
    if(!('speechSynthesis' in window))return

    const load=()=>{
      const list=japaneseVoices()
      setVoices(list)

      if(!voiceName&&list.length){
        const preferred=preferredJapaneseVoice()
        if(preferred){
          setVoiceName(preferred.name)
          localStorage.setItem(VOICE_NAME_KEY,preferred.name)
        }
      }
    }

    load()
    window.speechSynthesis.addEventListener('voiceschanged',load)
    return ()=>window.speechSynthesis.removeEventListener('voiceschanged',load)
  },[voiceName])

  const selectVoice=(name:string)=>{
    setVoiceName(name)
    localStorage.setItem(VOICE_NAME_KEY,name)
  }

  const selectSpeed=(value:VoiceSpeed)=>{
    setSpeed(value)
    localStorage.setItem(VOICE_SPEED_KEY,value)
  }

  return <div className="voice-settings">
    <div className="voice-settings-title">
      <span>일본어 음성</span>
      <button type="button" onClick={()=>speak('今日も一緒に頑張りましょう。')}>미리 듣기</button>
    </div>

    <select value={voiceName} onChange={event=>selectVoice(event.target.value)}>
      {voices.length
        ? voices.map(voice=><option value={voice.name} key={voice.name}>{voice.name}</option>)
        : <option value="">일본어 음성 불러오는 중</option>}
    </select>

    <div className="voice-speed-options">
      {([
        ['slow','천천히'],
        ['normal','보통'],
        ['natural','자연스럽게']
      ] as [VoiceSpeed,string][]).map(([value,label])=>
        <button
          type="button"
          className={speed===value?'active':''}
          onClick={()=>selectSpeed(value)}
          key={value}
        >{label}</button>
      )}
    </div>
  </div>
}

function normalizeJapanese(value:string){
  return value
    .normalize('NFKC')
    .replace(/[\s　]/g,'')
    .replace(/[。．.！!？?、,]/g,'')
    .trim()
}
function isJapaneseAnswerCorrect(input:string,answer:string|string[]){
  const answers=Array.isArray(answer)?answer:[answer]
  return answers.some(item=>normalizeJapanese(input)===normalizeJapanese(item))
}
function answerSegments(input:string,answer:string){
  const typed=normalizeJapanese(input)
  const correct=normalizeJapanese(answer)
  return Array.from(correct).map((char,index)=>({
    char,
    correct:typed[index]===char
  }))
}

export default function App(){
  const [user,setUser]=useState<User|null>(null)
  const [active,setActive]=useState<Learner|null>(null)
  const [loading,setLoading]=useState(true)
  const [mode,setMode]=useState<'login'|'create'>('login')
  const [name,setName]=useState('')
  const [pin,setPin]=useState('')
  const [view,setView]=useState<View>('home')
  const [previewMode,setPreviewMode]=useState(false)
  const [testIndex,setTestIndex]=useState(0)
  const [testScore,setTestScore]=useState(0)
  const [testStarted,setTestStarted]=useState(false)

  useEffect(()=>onAuthStateChanged(auth,async current=>{
    setUser(current)
    if(current){
      const learner=await readLearner(current.uid)
      setActive(learner?hydrateLearner(learner):null)
    }else setActive(null)
    setLoading(false)
  }),[])

  const persist=async(next:Learner)=>{
    if(!user)return
    const normalized=hydrateLearner(next)
    setActive(normalized)
    await saveLearner(user.uid,normalized)
  }

  const submitAuth=async()=>{
    const clean=name.trim()
    if(!clean)return alert('이름을 입력하세요.')
    if(!/^\d{6}$/.test(pin))return alert('PIN은 숫자 6자리로 입력하세요.')
    const email=nameToEmail(clean),password=pinToPassword(pin)
    try{
      if(mode==='create'){
        const result=await createUserWithEmailAndPassword(auth,email,password)
        const learner=createLearner(result.user.uid,clean)
        await saveLearner(result.user.uid,learner)
        setActive(learner)
      }else{
        const result=await signInWithEmailAndPassword(auth,email,password)
        const learner=await readLearner(result.user.uid)
        if(!learner)throw new Error('missing learner')
        setActive(hydrateLearner(learner))
      }
      setName('');setPin('')
    }catch(error){
      console.error(error)
      alert(mode==='create'?'이미 등록된 이름이거나 계정을 만들 수 없습니다.':'이름 또는 PIN이 맞지 않습니다.')
    }
  }

  const answerPlacement=async(choice:number)=>{
    const q=placementQuestions[testIndex]
    const score=testScore+(choice===q.answer?1:0)
    if(testIndex<placementQuestions.length-1){
      setTestScore(score);setTestIndex(testIndex+1);return
    }
    if(!active)return
    const ratio=score/placementQuestions.length
    const level=levels[Math.min(levels.length-1,Math.floor(ratio*levels.length))]
    await persist({...active,placementDone:true,placementScore:score,level})
    setTestStarted(false);setTestIndex(0);setTestScore(0)
  }

  const unlocked=(id:string)=>{
    if(!active)return false
    const lesson=lessons.find(x=>x.id===id)
    if(!lesson?.lockedBy)return true
    if(lesson.lockedBy==='hiragana')return active.hiraPassed
    if(lesson.lockedBy==='katakana')return active.kataPassed||active.katakanaAdvanceChoice==='move-on'
    return active.completedLessons.includes(lesson.lockedBy)
  }

  if(loading)return <Centered><h2>불러오는 중...</h2></Centered>

  if(!user||!active)return <Centered>
    <p className="eyebrow">PROJECT KOTONOHA</p>
    <h1>{mode==='create'?'새 학습자 만들기':'학습자 로그인'}</h1>
    <p className="muted">이름과 숫자 6자리 PIN만 사용합니다.</p>
    <div className="create-row">
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="이름"/>
      <input type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6자리 PIN"/>
      <button className="primary" onClick={submitAuth}>{mode==='create'?'등록':'로그인'}</button>
    </div>
    <button className="switch-mode" onClick={()=>setMode(mode==='create'?'login':'create')}>
      {mode==='create'?'이미 등록한 사용자가 있어요':'처음 사용하는 학습자예요'}
    </button>
    <small className="status">Firebase 온라인 동기화 연결됨</small>
  </Centered>

  if(!active.placementDone){
    if(!testStarted)return <Centered>
      <p className="eyebrow">LEVEL CHECK</p>
      <h1>{active.name}님의 실력을 확인할게요.</h1>
      <p className="muted">문자·어휘·문법·생활 회화를 확인합니다.</p>
      <button className="primary" onClick={()=>setTestStarted(true)}>진단 시작</button>
    </Centered>
    const q=placementQuestions[testIndex]
    return <Centered>
      <p className="eyebrow">{testIndex+1}/{placementQuestions.length}</p>
      <div className="test-progress"><i style={{width:`${testIndex/placementQuestions.length*100}%`}}/></div>
      <h2>{q.q}</h2>
      <div className="choices">{q.options.map((o,i)=><button key={o} onClick={()=>answerPlacement(i)}>{o}</button>)}</div>
    </Centered>
  }

  return <div className="shell">
    <aside>
      <div className="brand"><b>言</b><div><strong>KOTONOHA</strong><small>생활 회화형 일본어</small></div></div>
      <div className="learner"><span>학습자</span><strong>{active.name}</strong><small>{active.level}</small></div>

      <button className={`preview-toggle ${previewMode?'active':''}`} onClick={()=>setPreviewMode(!previewMode)}>
        <span>{previewMode?'미리보기 모드 ON':'미리보기 모드 OFF'}</span>
        <small>{previewMode?'모든 단원 자유 확인 중':'눌러서 모든 수업 확인'}</small>
      </button>

      <JapaneseVoiceSettings/>

      <nav>{(['home','today','conversation','course','kana','homework','review','video'] as View[]).map(v=>
        <button className={view===v?'active':''} onClick={()=>setView(v)} key={v}>
          {{home:'오늘의 홈',today:'오늘의 레슨',conversation:'실전 회화',course:'전체 과정',kana:'문자 마스터',homework:'숙제 문제',review:'오답노트',video:'영상 학습'}[v]}
        </button>)}</nav>
      <button className="logout" onClick={()=>signOut(auth)}>로그아웃</button>
    </aside>
    <main>
      <header><div><p className="eyebrow">PRIVATE STUDY</p><h2>{active.level}</h2></div><span className="pill">SYNC</span></header>
      {view==='home'&&<Home learner={active} setView={setView}/>}      {view==='today'&&<TodayLesson learner={active} persist={persist} setView={setView}/>}
      {view==='conversation'&&<ConversationPractice learner={active} persist={persist}/>} 
      {view==='course'&&<Course learner={active} unlocked={unlocked} setView={setView}/>}
      {view==='kana'&&<KanaTrainer learner={active} persist={persist} previewMode={previewMode}/>}
      {view==='review'&&<Review learner={active} persist={persist}/>}
      {view==='homework'&&<Homework learner={active} persist={persist}/>}
      {view==='video'&&<Video/>}
    </main>
  </div>
}

function Centered({children}:{children:React.ReactNode}){
  return <div className="auth"><div className="auth-card">{children}</div></div>
}
function Home({learner,setView}:{learner:Learner,setView:(v:View)=>void}){
  const hiraAvg=averageMastery(learner.hiraganaMastery)
  const homeworkCount=learner.homework?.problems?.length||0
  const recentWrong=learner.wrongAnswers.slice(-3).reverse()

  return <div className="lesson-home">
    <section className="lesson-home-hero">
      <div>
        <p className="eyebrow">PRIVATE LESSON · DAY {learner.lessonDay}</p>
        <h1>안녕하세요, {learner.name}님.</h1>
        <p>매일 20분, AI 담임과 함께하는 일본어 레슨</p>
        <button className="primary lesson-start-button" onClick={()=>setView(learner.homework?'homework':'today')}>
          {learner.homework?'숙제부터 시작':'오늘의 레슨 시작'}
        </button>
      </div>
      <div className="teacher-profile">
        <div className="teacher-face">さとう</div>
        <span>담임 선생님</span>
        <strong>사토 선생님</strong>
        <p>{learner.latestFeedback?.summary||'오늘도 서두르지 않고 정확하게 연습해봐요.'}</p>
      </div>
    </section>

    <div className="today-goals">
      <div><span>오늘 학습</span><strong>20분</strong></div>
      <div><span>연속 학습</span><strong>{learner.streak}일</strong></div>
      <div><span>히라가나</span><strong>{hiraAvg}%</strong></div>
      <div><span>숙제 문제</span><strong>{homeworkCount}개</strong></div>
    </div>

    <section className="daily-plan card">
      <div className="section-title-row">
        <div><p className="eyebrow">TODAY'S PLAN</p><h2>오늘의 레슨 순서</h2></div>
        <span className="level-chip">약 20분</span>
      </div>
      <div className="plan-flow">
        {[
          ['01','담임 인사','오늘 목표 확인'],
          ['02','문자·단어','발음과 뜻 연결'],
          ['03','직접 입력','일본어 문장 작성'],
          ['04','받아쓰기','소리를 듣고 입력'],
          ['05','피드백','오답과 숙제 생성']
        ].map(([number,title,desc])=><div key={number}>
          <b>{number}</b><strong>{title}</strong><span>{desc}</span>
        </div>)}
      </div>
    </section>

    <div className="home-bottom-grid">
      <section className="card">
        <p className="eyebrow">RECENT MISTAKES</p>
        <h2>최근 오답</h2>
        {recentWrong.length?recentWrong.map(item=><div className="mini-wrong" key={item.id}>
          <span>{item.submitted||'미입력'}</span><b>→</b><strong>{item.answer}</strong>
        </div>):<p className="muted">아직 저장된 오답이 없습니다.</p>}
        <button className="secondary spaced" onClick={()=>setView('review')}>오답노트 보기</button>
      </section>
      <section className="card conversation-home-card">
        <p className="eyebrow">ROLE PLAY</p>
        <h2>연습실 실전 회화</h2>
        <p className="muted">사토 선생님의 질문에 일본어로 직접 답해보세요.</p>
        <button className="secondary spaced" onClick={()=>setView('conversation')}>회화 시작</button>
      </section>
      <section className="card">
        <p className="eyebrow">HOMEWORK</p>
        <h2>{learner.homework?'오늘 숙제가 있어요.':'숙제 완료'}</h2>
        <p className="muted">{learner.homework?`${homeworkCount}문제를 풀어야 다음 레슨으로 이동할 수 있습니다.`:'새 레슨을 완료하면 문제형 숙제가 생성됩니다.'}</p>
        <button className="secondary spaced" disabled={!learner.homework} onClick={()=>setView('homework')}>숙제 풀기</button>
      </section>
    </div>
  </div>
}
function Stat({label,value}:{label:string,value:string}){return <div className="card"><span>{label}</span><strong>{value}</strong></div>}
function averageMastery(records:Record<string,MasteryRecord>){
  const values=Object.values(records);return values.length?Math.round(values.reduce((s,x)=>s+x.mastery,0)/values.length):0
}
function weakestKana(records:Record<string,MasteryRecord>){
  const weak=Object.entries(records).sort((a,b)=>a[1].mastery-b[1].mastery).slice(0,4).map(([c])=>c)
  return weak.length?`오늘은 ${weak.join('・')}를 먼저 복습하면 좋아요.`:'오늘의 학습을 시작해보세요.'
}


function buildAdaptiveHomework(learner:Learner,lessonWrong:WrongAnswer[]):HomeworkProblem[]{
  const now=Date.now()
  const reviewSource=[...lessonWrong,...learner.wrongAnswers.slice(-5)]
  const seen=new Set<string>()
  const reviewProblems:HomeworkProblem[]=[]

  reviewSource.reverse().forEach((item,index)=>{
    const key=normalizeJapanese(item.answer)
    if(seen.has(key)||reviewProblems.length>=3)return
    seen.add(key)
    reviewProblems.push({
      id:`review-${now}-${index}`,
      type:item.category==='dictation'?'dictation':'typing',
      prompt:item.category==='dictation'?'이전에 틀린 문장을 다시 듣고 입력하세요.':`복습 문제: ${item.prompt}`,
      answer:item.answer,
      acceptedAnswers:[item.answer],
      audio:item.category==='dictation'?item.answer:undefined,
      hint:'이전에 틀렸던 문제입니다. 천천히 다시 입력해보세요.',
      source:'mistake'
    })
  })

  const core:HomeworkProblem[]=[
    {
      id:`hw-${now}-1`,
      type:'typing',
      prompt:'“저는 연습생입니다.”를 일본어로 입력하세요.',
      answer:'わたしは れんしゅうせいです',
      answerKanji:'私は 練習生です',
      acceptedAnswers:['わたしはれんしゅうせいです','私は練習生です','私はれんしゅうせいです','わたしは練習生です'],
      hint:'연습생 = れんしゅうせい',
      source:'lesson'
    },
    {
      id:`hw-${now}-2`,
      type:'typing',
      prompt:'“저는 한국인입니다.”를 일본어로 입력하세요.',
      answer:'わたしは かんこくじんです',
      answerKanji:'私は 韓国人です',
      acceptedAnswers:['わたしはかんこくじんです','私は韓国人です','私はかんこくじんです','わたしは韓国人です'],
      hint:'한국인 = かんこくじん',
      source:'lesson'
    },
    {
      id:`hw-${now}-3`,
      type:'dictation',
      prompt:'소리를 듣고 그대로 입력하세요.',
      answer:'ありがとうございます',
      answerKanji:'有難うございます',
      acceptedAnswers:['ありがとうございます','有難うございます'],
      audio:'ありがとうございます',
      hint:'감사합니다.',
      source:'lesson'
    },
    {
      id:`hw-${now}-4`,
      type:'dictation',
      prompt:'소리를 듣고 그대로 입력하세요.',
      answer:'もういちど おねがいします',
      answerKanji:'もう一度 お願いします',
      acceptedAnswers:['もういちどおねがいします','もう一度お願いします','もういちどお願いします'],
      audio:'もういちどおねがいします',
      hint:'한 번 더 부탁드립니다.',
      source:'lesson'
    },
    {
      id:`hw-${now}-5`,
      type:'choice',
      prompt:'「せんせい」의 뜻은?',
      answer:'선생님',
      choices:['학생','선생님','연습생','회사원'],
      source:'lesson'
    }
  ]

  const katakanaAverage=averageMastery(learner.katakanaMastery)
  const katakanaReview:HomeworkProblem[]=[]

  if(learner.katakanaAdvanceChoice==='move-on'&&katakanaAverage<100){
    const weakKatakana=Object.entries(learner.katakanaMastery)
      .sort((a,b)=>a[1].mastery-b[1].mastery)
      .slice(0,katakanaAverage<70?5:katakanaAverage<90?3:2)

    weakKatakana.forEach(([char],index)=>{
      const reading=katakana.find(([kana])=>kana===char)?.[1]||''
      const distractors=katakana
        .filter(([kana,value])=>kana!==char&&value!==reading)
        .map(([,value])=>value)
        .sort(()=>Math.random()-.5)
        .slice(0,3)

      katakanaReview.push({
        id:`kata-review-${now}-${index}`,
        type:'choice',
        prompt:`가타카나 「${char}」의 발음은?`,
        answer:reading,
        choices:[reading,...distractors].sort(()=>Math.random()-.5),
        source:'kana'
      })
    })
  }

  return [...reviewProblems,...katakanaReview,...core].slice(0,10)
}

function TodayLesson({learner,persist,setView}:{learner:Learner,persist:(l:Learner)=>Promise<void>,setView:(v:View)=>void}){
  type LessonQuestion = {
    id:string
    type:'typing'|'dictation'
    prompt:string
    answer:string
    answerKanji?:string
    acceptedAnswers?:string[]
    audio?:string
    hint:string
  }

  const questions:LessonQuestion[]=[
    {id:'lesson-typing-1',type:'typing',prompt:'“저는 학생입니다.”를 일본어로 입력하세요.',answer:'わたしは がくせいです',answerKanji:'私は 学生です',acceptedAnswers:['わたしはがくせいです','私は学生です','私はがくせいです','わたしは学生です'],hint:'わたし + は + がくせい + です'},
    {id:'lesson-typing-2',type:'typing',prompt:'“저는 선생님입니다.”를 일본어로 입력하세요.',answer:'わたしは せんせいです',answerKanji:'私は 先生です',acceptedAnswers:['わたしはせんせいです','私は先生です','私はせんせいです','わたしは先生です'],hint:'학생(がくせい)을 선생님(せんせい)으로 바꿔보세요.'},
    {id:'lesson-dictation-1',type:'dictation',prompt:'소리를 듣고 일본어로 입력하세요.',answer:'こんにちは',audio:'こんにちは',hint:'こ 로 시작하는 인사입니다.'},
    {id:'lesson-dictation-2',type:'dictation',prompt:'소리를 듣고 일본어로 입력하세요.',answer:'よろしくおねがいします',audio:'よろしくおねがいします',hint:'처음 만났을 때 “잘 부탁드립니다”라는 표현입니다.'}
  ]

  const [stage,setStage]=useState<'intro'|'learn'|'questions'|'result'>('intro')
  const [index,setIndex]=useState(0)
  const [input,setInput]=useState('')
  const [feedback,setFeedback]=useState<'idle'|'correct'|'wrong'>('idle')
  const [hintVisible,setHintVisible]=useState(false)
  const [wrong,setWrong]=useState<WrongAnswer[]>([])
  const [score,setScore]=useState(0)
  const [finishing,setFinishing]=useState(false)

  const current=questions[index]

  const submit=()=>{
    if(!input.trim())return
    const correct=isJapaneseAnswerCorrect(input,current.acceptedAnswers||current.answer)
    setFeedback(correct?'correct':'wrong')
    if(correct)setScore(value=>value+1)
    else{
      setWrong(items=>[...items,{
        id:`${current.id}-${Date.now()}`,
        prompt:current.prompt,
        submitted:input,
        answer:current.answer,
        category:current.type,
        createdAt:new Date().toISOString()
      }])
    }

    window.requestAnimationFrame(()=>{
      document.querySelector('.lesson-question-actions')?.scrollIntoView({
        behavior:'smooth',
        block:'nearest'
      })
    })
  }

  const nextQuestion=async()=>{
    if(index<questions.length-1){
      setIndex(index+1)
      setInput('')
      setFeedback('idle')
      setHintVisible(false)
      return
    }

    const problems=buildAdaptiveHomework(learner,wrong)

    if(finishing)return
    setFinishing(true)

    const next=touched({
      ...learner,
      wrongAnswers:[...learner.wrongAnswers,...wrong].slice(-100),
      latestFeedback:{
        title:wrong.length?'거의 다 왔어요. 틀린 문장만 다시 복습해요.':'오늘 입력을 모두 정확히 마쳤어요.',
        summary:wrong.length?`${wrong.length}개 문장에서 수정할 부분을 찾았습니다.`:'직접 입력과 받아쓰기를 모두 정확히 완료했습니다.',
        strengths:['일본어 키보드로 직접 문장을 입력했습니다.','듣고 문장으로 옮기는 연습을 완료했습니다.'],
        focusChars:[],
        recommendation:wrong.length?'숙제에서 같은 문장 구조를 다시 입력해보세요.':'숙제로 새로운 단어를 넣어 응용해보세요.',
        recommendedMinutes:10,
        score:questions.length-wrong.length,
        total:questions.length,
        createdAt:new Date().toISOString()
      },
      homework:{
        title:'Day 1 직접 입력 숙제',
        tasks:[],
        problems,
        createdAt:new Date().toISOString()
      }
    })
    try{
      await persist(next)
      setStage('result')
      window.scrollTo({top:0,behavior:'smooth'})
    }finally{
      setFinishing(false)
    }
  }

  if(stage==='intro')return <div className="private-lesson-screen">
    <section className="teacher-dialog-card">
      <div className="teacher-face large">さとう</div>
      <div>
        <p className="eyebrow">사토 선생님</p>
        <h1>오늘은 일본어를 직접 입력해볼 거예요.</h1>
        <p>정답을 고르는 대신, 배운 문장을 일본어 키보드로 직접 작성합니다. 틀려도 괜찮아요. 수정할 부분만 같이 찾아볼게요.</p>
        <button className="primary large-button" onClick={()=>setStage('learn')}>레슨 시작</button>
      </div>
    </section>
  </div>

  if(stage==='learn')return <div className="private-lesson-screen">
    <section className="card lesson-teaching-card">
      <p className="eyebrow">TODAY'S EXPRESSION</p>
      <h1>わたしは がくせいです。</h1>
      <button className="sound-button" onClick={()=>speak('わたしはがくせいです')}>발음 듣기</button>
      <div className="sentence-breakdown">
        <div><strong>わたし</strong><span>저·나</span></div>
        <div><strong>は</strong><span>주제 조사</span></div>
        <div><strong>がくせい</strong><span>학생</span></div>
        <div><strong>です</strong><span>입니다</span></div>
      </div>
      <div className="teacher-tip">
        <b>선생님 팁</b>
        <p>문장 속 조사 「は」는 글자는 ha이지만 여기서는 wa로 읽습니다.</p>
      </div>
      <button className="primary large-button" onClick={()=>setStage('questions')}>직접 입력 시작</button>
    </section>
  </div>

  if(stage==='result')return <div className="private-lesson-screen">
    <section className="card lesson-result">
      <p className="eyebrow">LESSON COMPLETE</p>
      <div className="result-score">{questions.length-wrong.length}/{questions.length}</div>
      <h1>{wrong.length?'틀린 문장은 숙제에서 다시 만나요.':'오늘 레슨을 완벽하게 마쳤어요.'}</h1>
      <p>숙제는 체크리스트가 아니라 직접 풀어야 하는 5개의 문제로 생성되었습니다.</p>
      <button className="primary large-button" onClick={()=>setView('homework')}>숙제 문제 확인</button>
      <button className="secondary" onClick={()=>setView('home')}>홈으로 돌아가기</button>
    </section>
  </div>

  return <div className="private-lesson-screen">
    <section className="card input-question-card">
      <div className="question-header">
        <p className="eyebrow">QUESTION {index+1}/{questions.length}</p>
        <div className="question-meter"><i style={{width:`${((index+1)/questions.length)*100}%`}}/></div>
      </div>
      <h2>{current.prompt}</h2>
      {current.audio&&<button className="audio-play-big" onClick={()=>speak(current.audio!)}>♪ 소리 듣기</button>}

      <input
        className={`japanese-input ${feedback}`}
        lang="ja"
        value={input}
        onChange={e=>{setInput(e.target.value);setFeedback('idle')}}
        onKeyDown={e=>{if(e.key==='Enter')submit()}}
        placeholder="일본어로 직접 입력하세요"
        autoFocus
      />

      {feedback==='correct'&&<div className="gentle-feedback correct">
        <strong>좋아요! 정확하게 입력했어요.</strong>
        <div className="beginner-answer">
          <span className="answer-label">정답</span>
          <b>{current.answer}</b>
          {current.answerKanji&&<span className="kanji-answer">{current.answerKanji}</span>}
        </div>
      </div>}

      {feedback==='wrong'&&<div className="gentle-feedback wrong">
        <strong>{teacherCorrectionMessage(input,current.answer)}</strong>
        <div className="submitted-answer">
          <span className="answer-label">내 입력</span>
          <b>{input}</b>
        </div>
        <div className="beginner-answer">
          <span className="answer-label">정답</span>
          <b>{current.answer}</b>
          {current.answerKanji&&<span className="kanji-answer">{current.answerKanji}</span>}
        </div>
      </div>}

      {hintVisible&&<div className="hint-box">힌트: {current.hint}</div>}

      <div className="question-actions lesson-question-actions">
        <button className="secondary" onClick={()=>setHintVisible(true)}>힌트 보기</button>
        {feedback==='idle'
          ? <button className="primary" disabled={!input.trim()} onClick={submit}>확인하기</button>
          : <button className="primary lesson-next-button" disabled={finishing} onClick={nextQuestion}>
              {finishing?'저장 중...':index===questions.length-1?'수업 완료':'다음'}
            </button>}
      </div>
    </section>
  </div>
}


function ConversationPractice({learner,persist}:{learner:Learner,persist:(l:Learner)=>Promise<void>}){
  type ConversationTurn = {
    teacher:string
    teacherKo:string
    prompt:string
    accepted:string[]
    modelHiragana:string
    modelKanji:string
    hint:string
  }

  const turns:ConversationTurn[]=[
    {
      teacher:'こんにちは。きょうの ちょうしは どうですか？',
      teacherKo:'안녕하세요. 오늘 컨디션은 어때요?',
      prompt:'“좋습니다.” 또는 “조금 피곤합니다.”라고 일본어로 답해보세요.',
      accepted:['げんきです','元気です','ちょっとつかれています','ちょっと疲れています','すこしつかれています','少し疲れています'],
      modelHiragana:'げんきです。',
      modelKanji:'元気です。',
      hint:'좋습니다 = げんきです / 조금 피곤합니다 = ちょっと つかれています'
    },
    {
      teacher:'きょうは なんの れんしゅうを しますか？',
      teacherKo:'오늘은 어떤 연습을 하나요?',
      prompt:'“댄스 연습을 합니다.”라고 일본어로 입력하세요.',
      accepted:['ダンスのれんしゅうをします','ダンスの練習をします','ダンスれんしゅうをします','ダンス練習をします'],
      modelHiragana:'ダンスの れんしゅうを します。',
      modelKanji:'ダンスの 練習を します。',
      hint:'댄스 = ダンス / 연습 = れんしゅう / 합니다 = します'
    },
    {
      teacher:'わからない ところは ありますか？',
      teacherKo:'모르는 부분이 있나요?',
      prompt:'“한 번 더 부탁드립니다.”라고 일본어로 입력하세요.',
      accepted:['もういちどおねがいします','もう一度お願いします','もういちどお願いします'],
      modelHiragana:'もういちど おねがいします。',
      modelKanji:'もう一度 お願いします。',
      hint:'한 번 더 = もういちど / 부탁드립니다 = おねがいします'
    },
    {
      teacher:'では、もういちど やってみましょう。',
      teacherKo:'그럼 한 번 더 해봅시다.',
      prompt:'“네, 다시 해보겠습니다.”라고 일본어로 입력하세요.',
      accepted:['はいもういちどやってみます','はいもう一度やってみます','はいまたやってみます'],
      modelHiragana:'はい、もういちど やってみます。',
      modelKanji:'はい、もう一度 やってみます。',
      hint:'네 = はい / 다시 해보겠습니다 = もういちど やってみます'
    }
  ]

  const [index,setIndex]=useState(0)
  const [input,setInput]=useState('')
  const [feedback,setFeedback]=useState<'idle'|'correct'|'wrong'>('idle')
  const [hintVisible,setHintVisible]=useState(false)
  const [wrong,setWrong]=useState<WrongAnswer[]>([])
  const [done,setDone]=useState(false)

  const current=turns[index]

  const submit=()=>{
    if(!input.trim())return

    const correct=current.accepted.some(answer=>
      normalizeJapanese(answer)===normalizeJapanese(input)
    )

    setFeedback(correct?'correct':'wrong')

    if(!correct){
      setWrong(items=>[...items,{
        id:`conversation-${index}-${Date.now()}`,
        prompt:current.prompt,
        submitted:input,
        answer:current.modelHiragana,
        category:'typing',
        createdAt:new Date().toISOString()
      }])
    }
  }

  const next=async()=>{
    if(index<turns.length-1){
      setIndex(index+1)
      setInput('')
      setFeedback('idle')
      setHintVisible(false)
      return
    }

    const reviewProblems:HomeworkProblem[]=wrong.slice(-3).map((item,i)=>({
      id:`conversation-hw-${Date.now()}-${i}`,
      type:'typing',
      prompt:`실전 회화 복습: ${item.prompt}`,
      answer:item.answer,
      acceptedAnswers:[item.answer],
      hint:'오늘 회화에서 틀렸던 문장입니다.',
      source:'mistake'
    }))

    const previous=learner.homework?.problems||[]
    const nextHomework=reviewProblems.length
      ? {
          title:'실전 회화 복습 숙제',
          tasks:[],
          problems:[...reviewProblems,...previous].slice(0,10),
          createdAt:new Date().toISOString()
        }
      : learner.homework

    await persist(touched({
      ...learner,
      wrongAnswers:[...learner.wrongAnswers,...wrong].slice(-100),
      homework:nextHomework,
      latestFeedback:{
        title:wrong.length?'오늘 회화에서 어려웠던 문장을 다시 연습해요.':'연습실 회화를 정확하게 마쳤어요.',
        summary:wrong.length?`${wrong.length}개 문장을 오답노트와 숙제에 추가했습니다.`:'질문을 이해하고 일본어로 자연스럽게 답했습니다.',
        strengths:['일본어 질문을 읽고 직접 답했습니다.','연습실에서 자주 쓰는 표현을 사용했습니다.'],
        focusChars:[],
        recommendation:wrong.length?'숙제에서 같은 상황을 다시 말해보세요.':'다음에는 조금 더 긴 문장으로 답해보세요.',
        recommendedMinutes:wrong.length?10:5,
        score:turns.length-wrong.length,
        total:turns.length,
        createdAt:new Date().toISOString()
      }
    }))

    setDone(true)
  }

  if(done)return <div className="conversation-page">
    <section className="card conversation-result">
      <div className="teacher-face large">さとう</div>
      <p className="eyebrow">ROLE PLAY COMPLETE</p>
      <h1>실전 회화를 마쳤어요.</h1>
      <p>{wrong.length
        ? `${wrong.length}개 문장은 오답노트와 숙제에서 다시 연습할게요.`
        : '오늘 대화를 모두 정확하게 이어갔어요.'}</p>
      <div className="conversation-summary">
        <strong>{turns.length-wrong.length}/{turns.length}</strong>
        <span>정확한 응답</span>
      </div>
    </section>
  </div>

  return <div className="conversation-page">
    <div className="conversation-progress">
      <span>연습실 회화</span>
      <b>{index+1}/{turns.length}</b>
    </div>

    <section className="conversation-chat card">
      <div className="teacher-message">
        <div className="teacher-face small">さとう</div>
        <div>
          <span>사토 선생님</span>
          <p className="japanese-dialogue">{current.teacher}</p>
          <small>{current.teacherKo}</small>
          <button className="dialogue-audio" onClick={()=>speak(current.teacher)}>질문 듣기</button>
        </div>
      </div>

      <div className="student-response">
        <p>{current.prompt}</p>
        <input
          className={`japanese-input ${feedback}`}
          lang="ja"
          value={input}
          onChange={event=>{
            setInput(event.target.value)
            setFeedback('idle')
          }}
          onKeyDown={event=>{
            if(event.key==='Enter')submit()
          }}
          placeholder="일본어로 답하세요"
          autoFocus
        />

        {hintVisible&&<div className="hint-box">힌트: {current.hint}</div>}

        {feedback==='correct'&&<div className="gentle-feedback correct">
          <strong>좋아요! 자연스럽게 대답했어요.</strong>
          <div className="beginner-answer">
            <span className="answer-label">기본 표현</span>
            <b>{current.modelHiragana}</b>
            <span className="kanji-answer">{current.modelKanji}</span>
          </div>
        </div>}

        {feedback==='wrong'&&<div className="gentle-feedback wrong">
          <strong>{teacherCorrectionMessage(input,current.modelHiragana)}</strong>
          <div className="submitted-answer">
            <span className="answer-label">내 답변</span>
            <b>{input}</b>
          </div>
          <div className="beginner-answer">
            <span className="answer-label">이렇게 말해볼 수 있어요</span>
            <b>{current.modelHiragana}</b>
            <span className="kanji-answer">{current.modelKanji}</span>
          </div>
          <button className="dialogue-audio retry" onClick={()=>speak(current.modelHiragana)}>정답 듣기</button>
        </div>}

        <div className="question-actions">
          <button className="secondary" onClick={()=>setHintVisible(true)}>힌트 보기</button>
          {feedback==='idle'
            ? <button className="primary" disabled={!input.trim()} onClick={submit}>답변하기</button>
            : <button className="primary" onClick={next}>{index===turns.length-1?'회화 완료':'다음 대화'}</button>}
        </div>
      </div>
    </section>
  </div>
}

function Course({learner,unlocked,setView}:{learner:Learner,unlocked:(id:string)=>boolean,setView:(v:View)=>void}){
  const isKanaLesson=(id:string)=>id.startsWith('hira-')||id.startsWith('kata-')

  return <div className="course-page">
    <div className="course-notice card">
      <div>
        <p className="eyebrow">CURRICULUM</p>
        <h2>전체 학습 과정</h2>
        <p>실제 학습 내용이 완성된 과정만 시작할 수 있습니다. 버튼을 누르는 것만으로 수업이 완료되지는 않습니다.</p>
      </div>
      <button className="primary" onClick={()=>setView('kana')}>문자 수업 시작</button>
    </div>

    <div className="lesson-list">
      {lessons.map(lesson=>{
        const open=unlocked(lesson.id)
        const kanaLesson=isKanaLesson(lesson.id)
        const done=learner.completedLessons.includes(lesson.id)
        const status=!open?'잠김':kanaLesson?'학습 가능':'준비 중'

        return <div className={`lesson ${!open?'locked':''} ${!kanaLesson&&open?'coming-soon':''}`} key={lesson.id}>
          <div>
            <div className="lesson-meta-row">
              <small>{lesson.stage} · 약 {lesson.duration}분</small>
              <span className={`course-status ${status==='학습 가능'?'ready':status==='잠김'?'locked-status':'soon'}`}>{status}</span>
            </div>
            <h3>{lesson.title}</h3>
            <p>{lesson.description}</p>
            {!kanaLesson&&open&&<p className="coming-copy">문법 설명·예문·연습 문제·숙제까지 준비된 후 열립니다.</p>}
          </div>
          {kanaLesson
            ? <button disabled={!open} onClick={()=>setView('kana')}>{!open?'잠김':done?'문자 과정에서 복습':'문자 과정에서 학습'}</button>
            : <button disabled>준비 중</button>}
        </div>
      })}
    </div>
  </div>
}

function KanaTrainer({learner,persist,previewMode}:{learner:Learner,persist:(l:Learner)=>Promise<void>,previewMode:boolean}){
  type Unit = {
    id:string
    title:string
    chars:string[]
    tip:string
    words:readonly (readonly [string,string])[]
    phrases:readonly (readonly [string,string])[]
  }
  type QuizItem = {
    prompt:string
    display?:string
    audio?:string
    answer:string
    choices:string[]
    targetChar?:string
  }

  const [type,setType]=useState<KanaType>('hiragana')
  const [screen,setScreen]=useState<'overview'|'lesson'|'quiz'|'result'>('overview')
  const [lessonStep,setLessonStep]=useState(0)
  const [unitIndex,setUnitIndex]=useState(0)
  const [quizIndex,setQuizIndex]=useState(0)
  const [score,setScore]=useState(0)
  const [wrongChars,setWrongChars]=useState<string[]>([])
  const [quizItems,setQuizItems]=useState<QuizItem[]>([])
  const [heardChars,setHeardChars]=useState<string[]>([])
  const [heardWords,setHeardWords]=useState<string[]>([])
  const [heardPhrases,setHeardPhrases]=useState<string[]>([])

  const hiraUnits:Unit[] = [
    {
      id:'hira-a', title:'あ행', chars:['あ','い','う','え','お'],
      tip:'입을 자연스럽게 열고 a·i·u·e·o의 다섯 모음을 분명하게 구분합니다.',
      words:[['あお','파랑'],['いえ','집'],['うえ','위'],['え','그림'],['おい','조카']],
      phrases:[['あおです。','파란색입니다.'],['いえです。','집입니다.']]
    },
    {
      id:'hira-ka', title:'か행', chars:['か','き','く','け','こ'],
      tip:'모음 앞에 가볍게 k 소리를 붙입니다. く는 입술을 과하게 둥글게 만들지 않습니다.',
      words:[['あか','빨강'],['えき','역'],['かお','얼굴'],['こえ','목소리'],['かき','감/굴']],
      phrases:[['えきはどこですか？','역은 어디입니까?'],['あかです。','빨간색입니다.']]
    },
    {
      id:'hira-sa', title:'さ행', chars:['さ','し','す','せ','そ'],
      tip:'し는 si가 아니라 shi에 가깝고, す의 u는 매우 약하게 들릴 수 있습니다.',
      words:[['すし','초밥'],['あさ','아침'],['そこ','거기'],['せき','자리'],['かさ','우산']],
      phrases:[['そこです。','거기입니다.'],['すしです。','초밥입니다.']]
    },
    {
      id:'hira-ta', title:'た행', chars:['た','ち','つ','て','と'],
      tip:'ちは chi, つ는 tsu로 읽습니다. 두 글자를 일반적인 ti·tu로 읽지 않도록 주의합니다.',
      words:[['たこ','문어'],['つき','달'],['て','손'],['とし','나이'],['ちか','지하']],
      phrases:[['つきです。','달입니다.'],['ちかです。','지하입니다.']]
    },
    {
      id:'hira-na', title:'な행', chars:['な','に','ぬ','ね','の'],
      tip:'ぬ·ね는 모양이 비슷합니다. 끝부분의 곡선 방향을 보며 구분합니다.',
      words:[['ねこ','고양이'],['いぬ','개'],['なつ','여름'],['にく','고기'],['のり','김']],
      phrases:[['ねこです。','고양이입니다.'],['にくです。','고기입니다.']]
    },
    {
      id:'hira-ha-ma', title:'は·ま행', chars:['は','ひ','ふ','へ','ほ','ま','み','む','め','も'],
      tip:'ふ는 fu와 hu의 중간에 가깝습니다. 입술 사이로 부드럽게 바람을 냅니다.',
      words:[['はな','꽃'],['ひと','사람'],['ふね','배'],['まち','도시'],['みみ','귀'],['あめ','비/사탕']],
      phrases:[['ひとです。','사람입니다.'],['はなです。','꽃입니다.']]
    },
    {
      id:'hira-ya-ra-wa', title:'や·ら·わ행', chars:['や','ゆ','よ','ら','り','る','れ','ろ','わ','を','ん'],
      tip:'일본어 r음은 혀끝을 윗잇몸에 가볍게 한 번 튕깁니다. を는 보통 조사로 쓰이며 o로 읽습니다.',
      words:[['やま','산'],['ゆき','눈'],['よる','밤'],['そら','하늘'],['わたし','나'],['ほん','책']],
      phrases:[['わたしです。','저입니다.'],['ほんです。','책입니다.']]
    }
  ]

  const kataUnits:Unit[] = [
    {
      id:'kata-a-ka', title:'ア·カ행', chars:['ア','イ','ウ','エ','オ','カ','キ','ク','ケ','コ'],
      tip:'가타카나는 외래어에 자주 사용합니다. 히라가나와 발음은 같지만 모양이 다릅니다.',
      words:[['アイス','아이스크림'],['カメラ','카메라'],['ケーキ','케이크'],['ココア','코코아']],
      phrases:[['アイスです。','아이스크림입니다.'],['カメラです。','카메라입니다.']]
    },
    {
      id:'kata-sa-ta', title:'サ·タ행', chars:['サ','シ','ス','セ','ソ','タ','チ','ツ','テ','ト'],
      tip:'シ·ツ는 점과 획의 방향이 비슷하므로 반복해서 비교합니다.',
      words:[['テスト','시험'],['スーツ','정장'],['タクシー','택시'],['ホテル','호텔']],
      phrases:[['テストです。','시험입니다.'],['ホテルです。','호텔입니다.']]
    },
    {
      id:'kata-na-ha', title:'ナ·ハ행', chars:['ナ','ニ','ヌ','ネ','ノ','ハ','ヒ','フ','ヘ','ホ'],
      tip:'ノ·ン·ソ는 획의 시작 방향과 기울기를 보고 구분합니다.',
      words:[['ナイフ','나이프'],['ノート','노트'],['ホテル','호텔'],['コーヒー','커피']],
      phrases:[['ノートです。','노트입니다.'],['コーヒーです。','커피입니다.']]
    },
    {
      id:'kata-ma-ya-ra-wa', title:'マ·ヤ·ラ·ワ행', chars:['マ','ミ','ム','メ','モ','ヤ','ユ','ヨ','ラ','リ','ル','レ','ロ','ワ','ヲ','ン'],
      tip:'장음 기호 ー는 앞의 모음을 길게 발음합니다.',
      words:[['メモ','메모'],['ラーメン','라멘'],['レストラン','레스토랑'],['スマホ','스마트폰']],
      phrases:[['ラーメンです。','라멘입니다.'],['スマホです。','스마트폰입니다.']]
    }
  ]

  const units=type==='hiragana'?hiraUnits:kataUnits
  const source=type==='hiragana'?hiragana:katakana
  const records=type==='hiragana'?learner.hiraganaMastery:learner.katakanaMastery
  const hiraganaAverage=averageMastery(learner.hiraganaMastery)
  const katakanaAverage=averageMastery(learner.katakanaMastery)
  const hiraganaReady=hiraganaAverage>=100
  const typeLocked=!previewMode&&type==='katakana'&&!hiraganaReady
  const unit=units[unitIndex]

  const unitComplete=(index:number)=>learner.completedLessons.includes(units[index].id)
  const unitUnlocked=(index:number)=>{
    if(previewMode)return true
    if(typeLocked)return false
    if(index===0)return true
    return unitComplete(index-1)
  }

  const startLesson=(index:number)=>{
    if(!unitUnlocked(index))return
    if(learner.homework&&!previewMode){
      alert('새 수업 전에 지난 숙제를 먼저 확인해주세요.')
      return
    }
    setUnitIndex(index)
    setLessonStep(0)
    setQuizIndex(0)
    setScore(0)
    setWrongChars([])
    setHeardChars([])
    setHeardWords([])
    setHeardPhrases([])
    setScreen('lesson')
  }

  const listenChar=(char:string)=>{
    speak(char,'character')
    setHeardChars(prev=>prev.includes(char)?prev:[...prev,char])
  }
  const listenWord=(word:string)=>{
    speak(word)
    setHeardWords(prev=>prev.includes(word)?prev:[...prev,word])
  }
  const listenPhrase=(phrase:string)=>{
    speak(phrase)
    setHeardPhrases(prev=>prev.includes(phrase)?prev:[...prev,phrase])
  }

  const canAdvance=()=>{
    if(lessonStep===1)return unit.chars.every(c=>heardChars.includes(c))
    if(lessonStep===2)return unit.words.every(([w])=>heardWords.includes(w))
    if(lessonStep===3)return unit.phrases.every(([p])=>heardPhrases.includes(p))
    return true
  }

  const makeQuiz=():QuizItem[]=>{
    const readingItems=unit.chars.map(char=>{
      const reading=source.find(([c])=>c===char)?.[1]||''
      const distractors=source
        .filter(([c,r])=>c!==char&&r!==reading)
        .sort(()=>Math.random()-.5)
        .slice(0,3)
        .map(([,r])=>r)
      return {
        prompt:'이 문자의 발음은 무엇인가요?',
        display:char,
        answer:reading,
        choices:[reading,...distractors].sort(()=>Math.random()-.5),
        targetChar:char
      }
    })

    const listeningItems=unit.chars.slice(0,Math.min(3,unit.chars.length)).map(char=>{
      const distractors=unit.chars.filter(c=>c!==char).sort(()=>Math.random()-.5).slice(0,3)
      return {
        prompt:'소리를 듣고 알맞은 문자를 고르세요.',
        audio:char,
        answer:char,
        choices:[char,...distractors].sort(()=>Math.random()-.5),
        targetChar:char
      }
    })

    const wordItems=unit.words.map(([word,meaning])=>{
      const distractors=unit.words.filter(([w])=>w!==word).map(([,m])=>m).sort(()=>Math.random()-.5).slice(0,3)
      const generic=['사람','학교','물','친구'].filter(x=>x!==meaning)
      const choices=[meaning,...distractors,...generic].filter((x,i,a)=>a.indexOf(x)===i).slice(0,4)
      return {
        prompt:'이 단어의 뜻은 무엇인가요?',
        display:word,
        answer:meaning,
        choices:choices.sort(()=>Math.random()-.5)
      }
    })

    return [...readingItems,...listeningItems,...wordItems].sort(()=>Math.random()-.5)
  }

  const beginQuiz=()=>{
    setQuizItems(makeQuiz())
    setQuizIndex(0)
    setScore(0)
    setWrongChars([])
    setScreen('quiz')
  }

  const answer=async(choice:string)=>{
    const item=quizItems[quizIndex]
    const correct=choice===item.answer
    const target=item.targetChar
    const nextWrong=!correct&&target?[...wrongChars,target]:wrongChars
    setWrongChars(nextWrong)

    let next=learner
    if(target){
      const old=records[target]||{correct:0,wrong:0,mastery:0,lastReviewedAt:null}
      const updated={
        ...old,
        correct:old.correct+(correct?1:0),
        wrong:old.wrong+(correct?0:1),
        mastery:Math.max(0,Math.min(100,old.mastery+(correct?15:-15))),
        lastReviewedAt:new Date().toISOString()
      }
      next=type==='hiragana'
        ? {...learner,hiraganaMastery:{...learner.hiraganaMastery,[target]:updated}}
        : {...learner,katakanaMastery:{...learner.katakanaMastery,[target]:updated}}
    }

    const nextScore=score+(correct?1:0)
    setScore(nextScore)

    if(type==='katakana'&&averageMastery(next.katakanaMastery)>=100){
      next={...next,kataPassed:true,katakanaAdvanceChoice:'move-on'}
    }
    if(type==='hiragana'&&averageMastery(next.hiraganaMastery)>=100){
      next={...next,hiraPassed:true}
    }

    await persist(touched(next))

    if(quizIndex<quizItems.length-1){
      setQuizIndex(quizIndex+1)
      return
    }

    const passed=nextScore===quizItems.length
    const uniqueWrong=[...new Set(nextWrong)]
    const completed=passed&&!next.completedLessons.includes(unit.id)
      ? [...next.completedLessons,unit.id]
      : next.completedLessons

    const feedback={
      title:passed?'단원을 100% 통과했습니다.':'아직 통과하지 못했습니다.',
      summary:passed
        ? `${unit.title}의 문자·듣기·단어 문제를 모두 맞혔습니다.`
        : `${quizItems.length-nextScore}문제를 틀렸습니다. 같은 단원을 다시 학습해야 합니다.`,
      strengths:passed
        ? ['문자와 발음을 정확히 연결했습니다.','단어의 뜻까지 정확히 기억했습니다.']
        : ['전체 학습 단계를 끝까지 진행했습니다.','헷갈리는 부분을 확인했습니다.'],
      focusChars:uniqueWrong,
      recommendation:passed
        ? '숙제를 마친 후 다음 단원으로 넘어가세요.'
        : `${uniqueWrong.length?uniqueWrong.join('・')+'를 먼저 복습하고, ':''}단어와 듣기 문제를 다시 풀어보세요.`,
      recommendedMinutes:passed?10:15,
      score:nextScore,
      total:quizItems.length,
      createdAt:new Date().toISOString()
    }

    next={
      ...next,
      completedLessons:completed,
      latestFeedback:feedback,
      homework:{
        title:passed?`${unit.title} 완료 복습`:`${unit.title} 재도전 준비`,
        createdAt:new Date().toISOString(),
        tasks:passed
          ? [
              `${unit.chars.join('・')}를 순서대로 3회 읽기`,
              `${unit.words.map(([w])=>w).join(', ')}를 각각 3회 읽기`,
              `${unit.phrases.map(([p])=>p).join(' / ')}를 따라 말하기`
            ]
          : [
              `${uniqueWrong.length?uniqueWrong.join('・'):unit.chars.join('・')}를 각각 5회 읽기`,
              '오늘 단어를 다시 듣고 한국어 뜻 말하기',
              '같은 단원 종합 문제에 다시 도전하기'
            ]
      }
    }
    await persist(touched(next))
    setScreen('result')
  }

  if(screen==='lesson'){
    const steps=[
      {
        title:'오늘 배울 내용',
        body:<div className="lesson-intro-panel">
          <span className="lesson-badge">{unit.title}</span>
          <h3>{unit.chars.join('・')}</h3>
          <p>{unit.tip}</p>
          <div className="time-plan">
            <span>문자 5분</span><span>단어 5분</span><span>표현 3분</span><span>듣기·문제 7분</span>
          </div>
        </div>
      },
      {
        title:'문자와 발음',
        body:<>
          <p className="step-guide">각 문자를 눌러 발음을 모두 들어야 다음으로 넘어갈 수 있습니다.</p>
          <div className="lesson-char-grid">
            {unit.chars.map(char=>{
              const reading=source.find(([c])=>c===char)?.[1]
              const heard=heardChars.includes(char)
              return <button className={heard?'heard':''} key={char} onClick={()=>listenChar(char)}>
                <strong>{char}</strong><span>{reading}</span><em>{heard?'확인 완료':'눌러서 듣기'}</em>
              </button>
            })}
          </div>
        </>
      },
      {
        title:'문자로 만든 단어',
        body:<>
          <p className="step-guide">단어를 하나씩 눌러 발음과 뜻을 연결하세요.</p>
          <div className="lesson-word-list">
            {unit.words.map(([word,meaning])=>{
              const heard=heardWords.includes(word)
              return <button className={heard?'heard':''} key={word} onClick={()=>listenWord(word)}>
                <div><strong>{word}</strong><span>{meaning}</span></div><b>{heard?'확인 완료':'듣기'}</b>
              </button>
            })}
          </div>
        </>
      },
      {
        title:'짧은 표현으로 말하기',
        body:<>
          <p className="step-guide">단어가 문장 속에서 어떻게 사용되는지 듣고 따라 말하세요.</p>
          <div className="phrase-list">
            {unit.phrases.map(([phrase,meaning])=>{
              const heard=heardPhrases.includes(phrase)
              return <button className={heard?'heard':''} key={phrase} onClick={()=>listenPhrase(phrase)}>
                <strong>{phrase}</strong><span>{meaning}</span><em>{heard?'따라 말하기 완료':'발음 듣기'}</em>
              </button>
            })}
          </div>
        </>
      },
      {
        title:'수업 내용 정리',
        body:<div className="lesson-checklist">
          <div><b>문자</b><span>{heardChars.length}/{unit.chars.length}개 발음 확인</span></div>
          <div><b>단어</b><span>{heardWords.length}/{unit.words.length}개 발음 확인</span></div>
          <div><b>표현</b><span>{heardPhrases.length}/{unit.phrases.length}개 발음 확인</span></div>
          <p>종합 문제는 문자 읽기, 소리 듣기, 단어 뜻 문제로 구성됩니다. 전부 맞혀야 단원이 완료됩니다.</p>
        </div>
      }
    ]

    const last=lessonStep===steps.length-1
    const advanceAllowed=canAdvance()

    return <div className="guided-lesson">
      <div className="lesson-top">
        <div><p className="eyebrow">20 MINUTE LESSON</p><h2>{unit.title}</h2></div>
        <span>{lessonStep+1}/{steps.length+1}</span>
      </div>
      <div className="lesson-stepper">
        {['안내','문자','단어','표현','정리','평가'].map((label,index)=>
          <i key={label} className={index<=lessonStep?'active':''}>{label}</i>
        )}
      </div>
      <section className="lesson-content card">
        {previewMode&&<div className="preview-step-nav">
          {['안내','문자','단어','표현','정리'].map((label,index)=>
            <button key={label} className={lessonStep===index?'active':''} onClick={()=>{
              setLessonStep(index)
              if(index>=1)setHeardChars(unit.chars)
              if(index>=2)setHeardWords(unit.words.map(([w])=>w))
              if(index>=3)setHeardPhrases(unit.phrases.map(([p])=>p))
            }}>{label}</button>
          )}
          <button onClick={()=>{
            setQuizItems(makeQuiz())
            setQuizIndex(0)
            setScore(0)
            setScreen('quiz')
          }}>평가 미리보기</button>
        </div>}
        <p className="eyebrow">STEP {lessonStep+1}</p>
        <h2>{steps[lessonStep].title}</h2>
        {steps[lessonStep].body}
        {!advanceAllowed&&<p className="required-message">이 단계의 모든 항목을 눌러 확인해야 다음으로 이동할 수 있습니다.</p>}
        <div className="lesson-actions">
          {lessonStep>0&&<button className="secondary" onClick={()=>setLessonStep(lessonStep-1)}>이전</button>}
          <button className="primary" disabled={!advanceAllowed} onClick={()=>last?beginQuiz():setLessonStep(lessonStep+1)}>
            {last?'종합 문제 시작':'다음 단계'}
          </button>
        </div>
      </section>
    </div>
  }

  if(screen==='quiz'){
    const item=quizItems[quizIndex]
    return <div className="card quiz-card">
      {previewMode&&<div className="preview-quiz-tools">
        <button className="secondary" onClick={()=>setQuizIndex(Math.min(quizItems.length-1,quizIndex+1))}>다음 문제 보기</button>
        <button className="secondary" onClick={()=>{
          setScore(quizItems.length)
          setScreen('result')
        }}>결과 화면 보기</button>
      </div>}
      <p className="eyebrow">종합 문제 {quizIndex+1}/{quizItems.length}</p>
      {item.display&&<div className={item.display.length>1?'quiz-word':'quiz-char'}>{item.display}</div>}
      {item.audio&&<>
        <div className="audio-question-mark">♪</div>
        <button className="sound-button" onClick={()=>speak(item.audio!)}>문제 소리 듣기</button>
      </>}
      <h3>{item.prompt}</h3>
      <div className="choices">{item.choices.map(choice=>
        <button key={choice} onClick={()=>answer(choice)}>{choice}</button>
      )}</div>
    </div>
  }

  if(screen==='result'){
    const feedback=learner.latestFeedback
    const passed=score===quizItems.length
    return <div className={`card result-card ${passed?'passed':'failed'}`}>
      <p className="eyebrow">{previewMode?'PREVIEW RESULT':passed?'UNIT PASSED':'RETRY NEEDED'}</p>
      <h1>{score}/{quizItems.length}</h1>
      <h2>{feedback?.title}</h2>
      <p>{feedback?.summary}</p>
      <div className="result-status">
        <strong>{previewMode?'미리보기 결과':passed?'단원 완료':'단원 미완료'}</strong>
        <span>{passed?'숙제 확인 후 다음 단원이 열립니다.':'숙제를 확인한 뒤 같은 단원에 다시 도전하세요.'}</span>
      </div>
      <div className="homework-preview">
        <strong>오늘의 숙제</strong>
        {learner.homework?.tasks.map(task=><div key={task}>✓ {task}</div>)}
      </div>
      <button className="primary" onClick={()=>setScreen('overview')}>단원 목록으로 돌아가기</button>
    </div>
  }

  return <>
    {previewMode&&<div className="preview-panel card">
      <div>
        <p className="eyebrow">DEVELOPER PREVIEW</p>
        <h3>모든 단원을 자유롭게 확인할 수 있습니다.</h3>
        <p>잠금, 숙제, 이전 단원 통과 조건을 임시로 건너뜁니다. 실제 학습 기록에는 완료로 저장되지 않습니다.</p>
      </div>
      <div className="preview-actions">
        <button className="secondary" onClick={()=>setScreen('overview')}>단원 목록</button>
        <button className="secondary" onClick={()=>{
          setUnitIndex(Math.min(units.length-1,unitIndex+1))
          setLessonStep(0)
          setHeardChars(units[Math.min(units.length-1,unitIndex+1)].chars)
          setHeardWords(units[Math.min(units.length-1,unitIndex+1)].words.map(([w])=>w))
          setHeardPhrases(units[Math.min(units.length-1,unitIndex+1)].phrases.map(([p])=>p))
          setScreen('lesson')
        }}>다음 단원 미리보기</button>
      </div>
    </div>}
    <div className="tabs">
      <button className={type==='hiragana'?'active':''} onClick={()=>{setType('hiragana');setUnitIndex(0)}}>히라가나</button>
      <button disabled={!previewMode&&!hiraganaReady} className={type==='katakana'?'active':''} onClick={()=>{setType('katakana');setUnitIndex(0)}}>가타카나</button>
    </div>

    {typeLocked
      ? <div className="card kana-gate-card">
          <p className="eyebrow">HIRAGANA FIRST</p>
          <h2>히라가나를 100% 익히면 가타카나가 열립니다.</h2>
          <p>현재 평균 숙련도는 <b>{hiraganaAverage}%</b>입니다. 기본 문장을 읽기 위해 히라가나는 완전히 익히고 넘어갈게요.</p>
        </div>
      : <>
        {type==='katakana'&&katakanaAverage>=50&&katakanaAverage<100&&
          <div className="katakana-choice-card card">
            <div className="teacher-face small">さとう</div>
            <div className="katakana-choice-copy">
              <p className="eyebrow">사토 선생님</p>
              <h3>가타카나를 {katakanaAverage}% 익혔어요.</h3>
              <p>
                지금 실전 일본어로 넘어가도 괜찮아요.
                다만 가타카나는 100%가 될 때까지 매일 숙제로 함께 복습할게요.
              </p>
              {learner.katakanaAdvanceChoice==='move-on'
                ? <div className="choice-confirmed">실전 과정과 가타카나 숙제를 함께 진행 중입니다.</div>
                : <div className="katakana-choice-actions">
                    <button className="secondary" onClick={()=>persist(touched({...learner,katakanaAdvanceChoice:'continue'}))}>
                      가타카나를 더 익힐래요
                    </button>
                    <button className="primary" onClick={()=>persist(touched({...learner,katakanaAdvanceChoice:'move-on'}))}>
                      실전 수업과 함께 복습할래요
                    </button>
                  </div>}
            </div>
          </div>}

        {learner.homework&&<div className="homework-lock card">
          <div><p className="eyebrow">HOMEWORK FIRST</p><h3>지난 숙제를 확인해야 새 단원을 시작할 수 있습니다.</h3></div>
        </div>}

        <div className="kana-summary card">
          <div><span>평균 숙련도</span><strong>{averageMastery(records)}%</strong></div>
          <div><span>과정 기준</span><strong>{type==='hiragana'?'100% 필수':'50%부터 선택'}</strong></div>
          <div><span>완료 단원</span><strong>{units.filter((_,i)=>unitComplete(i)).length}/{units.length}</strong></div>
          <div><span>다음 단계</span><strong>{units.find((_,i)=>!unitComplete(i))?.title||'전체 완료'}</strong></div>
        </div>

        <div className="unit-list">
          {units.map((current,index)=>{
            const complete=unitComplete(index)
            const unlocked=unitUnlocked(index)
            const avg=Math.round(current.chars.reduce((sum,char)=>sum+(records[char]?.mastery||0),0)/current.chars.length)
            return <button
              className={`unit-card ${complete?'complete':''} ${!unlocked?'locked-unit':''}`}
              key={current.id}
              disabled={!unlocked}
              onClick={()=>startLesson(index)}
            >
              <div>
                <span className="unit-number">LESSON {index+1}</span>
                <h3>{current.title}</h3>
                <p>{current.chars.join('・')}</p>
                <small>{complete?'100% 평가 통과':unlocked?'학습 가능':'이전 단원 완료 후 열림'}</small>
              </div>
              <div className="unit-progress">
                <strong>{complete?'완료':`${avg}%`}</strong>
                <div className="bar"><i style={{width:`${complete?100:avg}%`}}/></div>
              </div>
            </button>
          })}
        </div>
      </>}
  </>
}

function Review({learner}:{learner:Learner,persist:(l:Learner)=>Promise<void>}){
  const wrong=[...learner.wrongAnswers].reverse()
  return <div className="wrong-note-page">
    <div className="section-title-row">
      <div><p className="eyebrow">WRONG ANSWER NOTE</p><h1>오답노트</h1></div>
      <span className="level-chip">{wrong.length}개 저장</span>
    </div>
    {wrong.length?<div className="wrong-answer-list">{wrong.map(item=><article className="card" key={item.id}>
      <small>{item.category==='dictation'?'받아쓰기':item.category==='typing'?'직접 입력':'객관식'}</small>
      <h3>{item.prompt}</h3>
      <div className="wrong-comparison">
        <div><span>내 입력</span><strong>{item.submitted||'미입력'}</strong></div>
        <b>→</b>
        <div><span>정답</span><strong>{item.answer}</strong></div>
      </div>
      <button className="sound-button" onClick={()=>speak(item.answer)}>정답 발음 듣기</button>
    </article>)}</div>:<div className="card empty-note"><h2>아직 저장된 오답이 없습니다.</h2><p>직접 입력이나 받아쓰기에서 틀린 문장이 자동으로 모입니다.</p></div>}
  </div>
}
function Homework({learner,persist}:{learner:Learner,persist:(x:Learner)=>Promise<void>}){
  const problems=learner.homework?.problems||[]
  const [index,setIndex]=useState(0)
  const [input,setInput]=useState('')
  const [selected,setSelected]=useState('')
  const [feedback,setFeedback]=useState<'idle'|'correct'|'wrong'>('idle')
  const [wrong,setWrong]=useState<WrongAnswer[]>([])
  const [score,setScore]=useState(0)
  const [done,setDone]=useState(false)

  if(!learner.homework)return <div className="card empty-homework"><p className="eyebrow">HOMEWORK</p><h2>오늘 숙제는 모두 완료했어요.</h2><p>새 레슨을 끝내면 직접 입력과 받아쓰기 문제가 생성됩니다.</p></div>

  if(!problems.length){
    return <div className="card"><h2>{learner.homework.title}</h2><p>이전 형식의 숙제입니다. 완료 처리 후 새 레슨부터 문제형 숙제가 생성됩니다.</p>
      <button className="primary" onClick={()=>persist(touched({...learner,homework:null}))}>이전 숙제 완료 처리</button></div>
  }

  if(done)return <div className="card homework-result">
    <p className="eyebrow">HOMEWORK COMPLETE</p>
    <div className="result-score">{score}/{problems.length}</div>
    <h1>숙제를 완료했어요.</h1>
    <p>{wrong.length?`${wrong.length}문제가 오답노트에 저장되었습니다.`:'모든 문제를 정확하게 풀었습니다.'}</p>
    <div className="teacher-homework-comment">
      <div className="teacher-face small">さとう</div>
      <div>
        <b>사토 선생님</b>
        <p>{wrong.length?'틀린 문제는 다음 레슨 전에 다시 준비해둘게요. 오늘도 끝까지 잘했어요.':'오늘 배운 표현을 정확하게 복습했어요. 다음 레슨에서 새로운 표현을 시작해봐요.'}</p>
      </div>
    </div>
  </div>

  const problem=problems[index]
  const submitted=problem.type==='choice'?selected:input
  const submit=()=>{
    if(!submitted)return
    const correct=isJapaneseAnswerCorrect(submitted,problem.acceptedAnswers||problem.answer)
    setFeedback(correct?'correct':'wrong')
    if(correct)setScore(score+1)
    else setWrong(items=>[...items,{
      id:`homework-${problem.id}-${Date.now()}`,
      prompt:problem.prompt,
      submitted,
      answer:problem.answer,
      category:problem.type,
      createdAt:new Date().toISOString()
    }])
  }

  const next=async()=>{
    if(index<problems.length-1){
      setIndex(index+1);setInput('');setSelected('');setFeedback('idle');return
    }
    const nextLearner=touched({
      ...learner,
      wrongAnswers:[...learner.wrongAnswers,...wrong].slice(-100),
      homework:null,
      lessonDay:learner.lessonDay+1,
      latestFeedback:{
        title:wrong.length?'오늘 숙제에서 어려웠던 내용을 다시 준비할게요.':'오늘 숙제를 정확하게 완료했어요.',
        summary:wrong.length?`${wrong.length}개 문제를 오답노트에 저장했습니다.`:'숙제 문제를 모두 정확하게 풀었습니다.',
        strengths:['직접 일본어를 입력했습니다.','오늘 레슨 내용을 다시 복습했습니다.'],
        focusChars:[],
        recommendation:wrong.length?'다음 레슨 시작 전에 오답노트를 먼저 복습해보세요.':'다음 레슨에서는 새로운 표현으로 넘어가도 좋습니다.',
        recommendedMinutes:wrong.length?10:5,
        score:problems.length-wrong.length,
        total:problems.length,
        createdAt:new Date().toISOString()
      }
    })
    await persist(nextLearner)
    setDone(true)
  }

  return <div className="homework-quiz">
    <section className="card input-question-card">
      <div className="question-header">
        <p className="eyebrow">HOMEWORK {index+1}/{problems.length}</p>
        <div className="question-meter"><i style={{width:`${index/problems.length*100}%`}}/></div>
      </div>
      <div className={`homework-source ${problem.source||'lesson'}`}>
        {problem.source==='mistake'?'이전 오답 복습':problem.source==='kana'?'문자 복습':'오늘 레슨 복습'}
      </div>
      <h2>{problem.prompt}</h2>
      {problem.audio&&<button className="audio-play-big" onClick={()=>speak(problem.audio!)}>♪ 소리 듣기</button>}

      {problem.type==='choice'
        ? <div className="homework-choices">{problem.choices?.map(choice=><button className={selected===choice?'selected':''} onClick={()=>{setSelected(choice);setFeedback('idle')}} key={choice}>{choice}</button>)}</div>
        : <input className={`japanese-input ${feedback}`} lang="ja" value={input} onChange={e=>{setInput(e.target.value);setFeedback('idle')}} placeholder="일본어로 입력하세요" autoFocus/>}

      {feedback==='correct'&&<div className="gentle-feedback correct">
        <strong>좋아요! 정확합니다.</strong>
        <div className="beginner-answer">
          <span className="answer-label">정답</span>
          <b>{problem.answer}</b>
          {problem.answerKanji&&<span className="kanji-answer">{problem.answerKanji}</span>}
        </div>
      </div>}
      {feedback==='wrong'&&<div className="gentle-feedback wrong">
        <strong>{teacherCorrectionMessage(submitted,problem.answer)}</strong>
        <div className="submitted-answer">
          <span className="answer-label">내 입력</span>
          <b>{submitted}</b>
        </div>
        <div className="beginner-answer">
          <span className="answer-label">정답</span>
          <b>{problem.answer}</b>
          {problem.answerKanji&&<span className="kanji-answer">{problem.answerKanji}</span>}
        </div>
      </div>}

      <div className="question-actions">
        {problem.hint&&<button className="secondary" onClick={()=>alert(problem.hint)}>힌트</button>}
        {feedback==='idle'
          ? <button className="primary" disabled={!submitted} onClick={submit}>채점하기</button>
          : <button className="primary" onClick={next}>{index===problems.length-1?'숙제 완료':'다음 문제'}</button>}
      </div>
    </section>
  </div>
}
function Video(){return <div className="card"><p className="eyebrow">LICENSE-SAFE VIDEO</p><h2>영상 학습</h2><div className="video-placeholder"><strong>자유 라이선스 또는 직접 제작 영상</strong><span>영상·제작자·출처·라이선스를 함께 기록합니다.</span></div><ol><li>영상 전체 보기</li><li>대본 한 줄씩 보기</li><li>표현과 문법 설명</li><li>쉐도잉</li><li>받아쓰기</li><li>응용 회화</li></ol></div>}
