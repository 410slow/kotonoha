import { useEffect, useMemo, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { hiragana, katakana, lessons } from './data/curriculum'
import { placementQuestions } from './data/placement'
import { auth } from './lib/firebase'
import { readLearner, saveLearner } from './lib/storage'
import type { Learner, LevelName, MasteryRecord } from './types'

type View = 'home' | 'course' | 'kana' | 'homework' | 'review' | 'video'
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
    katakanaMastery:emptyMastery(katakana),hiraganaPassCount:0,katakanaPassCount:0,latestFeedback:null
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
function speak(text:string){
  if(!('speechSynthesis' in window))return
  const u=new SpeechSynthesisUtterance(text);u.lang='ja-JP';u.rate=.78
  speechSynthesis.cancel();speechSynthesis.speak(u)
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
    if(lesson.lockedBy==='katakana')return active.kataPassed
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

      <nav>{(['home','course','kana','review','homework','video'] as View[]).map(v=>
        <button className={view===v?'active':''} onClick={()=>setView(v)} key={v}>
          {{home:'오늘의 학습',course:'전체 과정',kana:'문자 마스터',review:'취약 문자',homework:'숙제',video:'영상 학습'}[v]}
        </button>)}</nav>
      <button className="logout" onClick={()=>signOut(auth)}>로그아웃</button>
    </aside>
    <main>
      <header><div><p className="eyebrow">PRIVATE STUDY</p><h2>{active.level}</h2></div><span className="pill">SYNC</span></header>
      {view==='home'&&<Home learner={active} setView={setView}/>}
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
  const kataAvg=averageMastery(learner.katakanaMastery)
  const weakChars=Object.entries(learner.hiraganaMastery)
    .sort((a,b)=>a[1].mastery-b[1].mastery)
    .slice(0,5)
    .map(([char])=>char)

  const nextTitle=learner.homework
    ? '지난 숙제 확인'
    : !learner.hiraPassed
      ? '히라가나 이어서 학습'
      : !learner.kataPassed
        ? '가타카나 이어서 학습'
        : '다음 문법 수업'

  const nextView:View=learner.homework
    ? 'homework'
    : (!learner.hiraPassed || !learner.kataPassed)
      ? 'kana'
      : 'course'

  return <div className="dashboard">
    <section className="welcome-panel">
      <div>
        <p className="eyebrow">TODAY'S STUDY</p>
        <h1>안녕하세요, {learner.name}님.</h1>
        <p>오늘도 20분만 정확하게 공부해볼까요?</p>
      </div>
      <div className="streak-badge">
        <span>연속 학습</span>
        <strong>{learner.streak}일</strong>
      </div>
    </section>

    <section className="today-card">
      <div className="today-copy">
        <span className="today-label">오늘의 학습</span>
        <h2>{nextTitle}</h2>
        <p>{learner.homework
          ? '새로운 수업 전에 지난 숙제를 먼저 확인합니다.'
          : '현재 단계에 맞는 학습을 이어서 진행합니다.'}</p>
        <button className="primary large-button" onClick={()=>setView(nextView)}>
          이어서 공부하기
        </button>
      </div>
      <div className="today-progress">
        <div className="progress-circle" style={{'--progress':`${hiraAvg}%`} as React.CSSProperties}>
          <div><strong>{hiraAvg}%</strong><span>히라가나</span></div>
        </div>
      </div>
    </section>

    <div className="quick-grid">
      <button className="quick-card" onClick={()=>setView('homework')}>
        <span className="quick-icon">✓</span>
        <div><small>숙제</small><strong>{learner.homework?'확인 필요':'완료'}</strong></div>
      </button>
      <button className="quick-card" onClick={()=>setView('review')}>
        <span className="quick-icon">復</span>
        <div><small>취약 문자</small><strong>{weakChars.join('・')}</strong></div>
      </button>
      <button className="quick-card" onClick={()=>setView('kana')}>
        <span className="quick-icon">あ</span>
        <div><small>문자 학습</small><strong>{learner.hiraPassed?'가타카나':'히라가나'}</strong></div>
      </button>
      <button className="quick-card" onClick={()=>setView('course')}>
        <span className="quick-icon">学</span>
        <div><small>전체 과정</small><strong>{learner.completedLessons.length}개 완료</strong></div>
      </button>
    </div>

    <section className="progress-section">
      <div className="section-title-row">
        <div><p className="eyebrow">PROGRESS</p><h2>현재 학습 진도</h2></div>
        <span className="level-chip">{learner.level}</span>
      </div>
      <div className="progress-list">
        <div className="progress-item">
          <div><strong>히라가나</strong><span>{learner.hiraPassed?'마스터 완료':'학습 중'}</span></div>
          <div className="bar"><i style={{width:`${hiraAvg}%`}}/></div>
          <b>{hiraAvg}%</b>
        </div>
        <div className={`progress-item ${learner.hiraPassed?'':'muted-row'}`}>
          <div><strong>가타카나</strong><span>{learner.hiraPassed?(learner.kataPassed?'마스터 완료':'학습 중'):'히라가나 완료 후 열림'}</span></div>
          <div className="bar"><i style={{width:`${kataAvg}%`}}/></div>
          <b>{kataAvg}%</b>
        </div>
        <div className={`progress-item ${learner.kataPassed?'':'muted-row'}`}>
          <div><strong>기초 문법</strong><span>{learner.kataPassed?'시작 가능':'가타카나 완료 후 열림'}</span></div>
          <div className="bar"><i style={{width:`${Math.min(100,learner.completedLessons.length*12)}%`}}/></div>
          <b>{Math.min(100,learner.completedLessons.length*12)}%</b>
        </div>
      </div>
    </section>

    <section className="teacher-card">
      <div className="teacher-avatar">先生</div>
      <div>
        <p className="eyebrow">담임 메모</p>
        <h3>{learner.latestFeedback?.title || (weakChars.length?`${weakChars.join('・')} 문자를 먼저 복습해보세요.`:'오늘의 학습을 시작해보세요.')}</h3>
        <p>{learner.latestFeedback?.summary || '취약 문자는 정답률과 숙련도를 기준으로 자동 추천됩니다.'}</p>
        {learner.latestFeedback&&<span className="feedback-time">추천 복습 {learner.latestFeedback.recommendedMinutes}분</span>}
      </div>
      <button className="secondary" onClick={()=>setView('review')}>복습하기</button>
    </section>
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
  const typeLocked=!previewMode&&type==='katakana'&&!learner.hiraPassed
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
    speak(char)
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
      <button disabled={!learner.hiraPassed} className={type==='katakana'?'active':''} onClick={()=>{setType('katakana');setUnitIndex(0)}}>가타카나</button>
    </div>

    {typeLocked
      ? <div className="card"><h2>가타카나는 아직 잠겨 있습니다.</h2><p>히라가나 전체 과정을 완료하고 종합평가를 통과해야 합니다.</p></div>
      : <>
        {learner.homework&&<div className="homework-lock card">
          <div><p className="eyebrow">HOMEWORK FIRST</p><h3>지난 숙제를 확인해야 새 단원을 시작할 수 있습니다.</h3></div>
        </div>}

        <div className="kana-summary card">
          <div><span>평균 숙련도</span><strong>{averageMastery(records)}%</strong></div>
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

function Review({learner,persist}:{learner:Learner,persist:(l:Learner)=>Promise<void>}){
  const weak=Object.entries(learner.hiraganaMastery).filter(([,r])=>r.mastery<100).sort((a,b)=>a[1].mastery-b[1].mastery).slice(0,12)
  return <div className="card"><p className="eyebrow">SMART REVIEW</p><h2>취약 히라가나</h2>
    {weak.length?<div className="review-grid">{weak.map(([c,r])=><button key={c} onClick={()=>speak(c)}><strong>{c}</strong><span>{r.mastery}%</span><small>정답 {r.correct} · 오답 {r.wrong}</small></button>)}</div>:<p>모든 히라가나가 100%입니다.</p>}
    <p className="muted">현재는 숙련도가 낮은 문자를 우선 표시합니다. 다음 버전에서는 간격 반복 날짜까지 자동 계산합니다.</p></div>
}

function Homework({learner,persist}:{learner:Learner,persist:(x:Learner)=>Promise<void>}){
  const [checks,setChecks]=useState<boolean[]>(learner.homework?.tasks.map(()=>false)||[])
  if(!learner.homework)return <div className="card"><h2>확인할 숙제가 없습니다.</h2></div>
  const finish=async()=>{if(checks.some(x=>!x))return alert('모든 숙제를 확인하세요.');await persist(touched({...learner,homework:null}))}
  return <div className="card"><p className="eyebrow">PREVIOUS HOMEWORK</p><h2>{learner.homework.title}</h2>
    {learner.homework.tasks.map((t,i)=><label className="homework-row" key={t}><span>{t}</span><input type="checkbox" checked={checks[i]} onChange={e=>setChecks(checks.map((x,j)=>j===i?e.target.checked:x))}/></label>)}
    <button className="primary spaced" onClick={finish}>숙제 확인 완료</button></div>
}
function Video(){return <div className="card"><p className="eyebrow">LICENSE-SAFE VIDEO</p><h2>영상 학습</h2><div className="video-placeholder"><strong>자유 라이선스 또는 직접 제작 영상</strong><span>영상·제작자·출처·라이선스를 함께 기록합니다.</span></div><ol><li>영상 전체 보기</li><li>대본 한 줄씩 보기</li><li>표현과 문법 설명</li><li>쉐도잉</li><li>받아쓰기</li><li>응용 회화</li></ol></div>}
