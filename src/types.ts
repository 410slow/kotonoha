export type LevelName =
  | '영유아' | '유아' | '초등학교 1학년' | '초등학교 2학년'
  | '초등학교 3학년' | '초등학교 4학년' | '초등학교 5학년'
  | '초등학교 6학년' | '중학교' | '고등학교' | '성인 생활 일본어'

export interface MasteryRecord {
  correct: number
  wrong: number
  mastery: number
  lastReviewedAt: string | null
}

export type HomeworkProblemType = 'typing' | 'dictation' | 'choice'

export interface HomeworkProblem {
  id: string
  type: HomeworkProblemType
  prompt: string
  answer: string
  answerKanji?: string
  acceptedAnswers?: string[]
  audio?: string
  choices?: string[]
  hint?: string
  source?: 'lesson' | 'mistake' | 'kana'
}

export interface Homework {
  title: string
  tasks: string[]
  createdAt: string
  problems?: HomeworkProblem[]
}

export interface WrongAnswer {
  id: string
  prompt: string
  submitted: string
  answer: string
  category: 'typing' | 'dictation' | 'choice'
  createdAt: string
}

export interface TeacherFeedback {
  title: string
  summary: string
  strengths: string[]
  focusChars: string[]
  recommendation: string
  recommendedMinutes: number
  score: number
  total: number
  createdAt: string
}

export interface Learner {
  id: string
  name: string
  level: LevelName | '미진단'
  placementDone: boolean
  placementScore: number
  hiraPassed: boolean
  kataPassed: boolean
  completedLessons: string[]
  homework: Homework | null
  streak: number
  lastStudyDate: string | null
  hiraganaMastery: Record<string, MasteryRecord>
  katakanaMastery: Record<string, MasteryRecord>
  hiraganaPassCount: number
  katakanaPassCount: number
  latestFeedback: TeacherFeedback | null
  wrongAnswers: WrongAnswer[]
  lessonDay: number
  katakanaAdvanceChoice: 'continue' | 'move-on' | null
}

export interface Lesson {
  id: string
  stage: string
  title: string
  description: string
  duration: number
  lockedBy?: 'hiragana' | 'katakana' | string
}
