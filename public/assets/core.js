'use strict';
/* =========================================================
   RegeneCure Journey — shared core
   Schedule engine, gamification, i18n and stage rendering.
   Loaded by index.html (practitioner) and client.html (client).
   ========================================================= */

const SLOTS = ['wake','breakfast','lunch','afternoon','dinner','bedtime'];
const SLOT_TIME = {wake:'06:30',breakfast:'08:00',lunch:'12:30',afternoon:'16:00',dinner:'19:30',bedtime:'22:00'};
const ALL_DAYS = [0,1,2,3,4,5,6];
const WEEK_ORDER = [1,2,3,4,5,6,0];
const LEVELS = [0,300,900,1800,3200,5000];
const XP = {report:150, stage:50, check:10, fullDay:25, followup:200, badge:100};
const MAX_FILE = 10 * 1024 * 1024;
const DEFAULT_SHOP = 'https://www.nurition.com/shop/maisa-ribeiro';
const LANG_KEY = 'regenecure.lang';

function initialLang(){
  try{ const v = localStorage.getItem(LANG_KEY); if(v === 'pt' || v === 'en') return v; }catch(e){}
  return (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en';
}
function setLang(l){ APP.lang = l; try{ localStorage.setItem(LANG_KEY, l); }catch(e){} }

/* Application state. mode: 'admin' | 'client' | 'preview' */
const APP = { mode:'admin', lang:initialLang(), settings:{ shopUrl:DEFAULT_SHOP, fitlineUrl:'', extractMode:'server', autoReminders:true }, client:null };
const S = APP;
const C = () => APP.client;
const isAdmin = () => APP.mode === 'admin';
const canWrite = () => APP.mode === 'client';
const shopUrl = () => APP.settings.shopUrl || DEFAULT_SHOP;
const fitlineUrl = () => APP.settings.fitlineUrl || '';
const waDigits = n => { let d = String(n||'').replace(/[^\d+]/g,''); if(d.startsWith('00')) d = d.slice(2); d = d.replace(/\+/g,''); return d.length >= 8 && d.length <= 15 ? d : ''; };
const normUrl = u => { u = (u||'').trim(); if(!u) return ''; return /^https?:\/\//i.test(u) ? u : 'https://' + u; };

/* ---------- i18n ---------- */
const I18N = {
  pt:{
    newClient:'Novo cliente', settings:'Configurações', welcomeKicker:'Jornada do cliente',
    welcomeTitle:'Cada protocolo, acompanhado do laudo ao follow-up',
    welcomeText:'Crie um cliente e envie o laudo. Os dados de exames, suplementos, peptídeos e follow-ups são extraídos do documento e organizados em 4 etapas.',
    createClient:'Criar cliente', loadDemo:'Ver demonstração',
    stage1:'Laudo', stage2:'Suplementos', stage3:'Peptídeos', stage4:'Follow-up',
    stage1Long:'Blood work report', stage2Long:'Suplementos e cronograma', stage3Long:'Peptídeos e ciclos', stage4Long:'Próximos follow-ups',
    stDone:'Concluída', stActive:'Em andamento', stLocked:'Aguardando laudo', stReview:'Revisar',
    journeyDay:'Dia {n} da jornada', startsIn:'Começa em {n} dias', notStarted:'Jornada não iniciada', started:'Início',
    level:'Nível', xpTo:'{x} XP para o nível {n}', maxLevel:'Nível máximo atingido',
    streak:'Sequência', days:'dias', day:'dia', adherence:'Adesão', nextFU:'Próximo follow-up', inDays:'em {n} dias', today:'hoje', overdue:'{n} dias atrás',
    dosesLogged:'Doses registradas', fullDays:'dias completos',
    lv:['Fundação','Consistência','Adaptação','Regeneração','Longevidade','Excelência'],
    b_baseline:'Linha de base', b_protocol:'Protocolo compreendido', b_calendar:'Agenda definida', b_streak7:'7 dias consistentes', b_streak21:'21 dias consistentes', b_adh90:'Adesão acima de 90%', b_cycle:'Ciclo concluído', b_fu1:'Primeiro follow-up',
    uploadTitle:'Enviar o laudo', uploadText:'Arraste o PDF ou a imagem do laudo aqui, ou', choose:'escolha o arquivo', uploadTypes:'PDF, JPG, PNG ou TXT · até 10 MB',
    replace:'Substituir laudo', addDoc:'Adicionar documento',
    addDocHint:'Use "Adicionar documento" quando o protocolo estiver em um arquivo separado do exame — os dados são combinados.',
    privacy:'Os dados ficam salvos apenas neste navegador. No modo IA, o arquivo é enviado à API da Anthropic para extração.',
    modeServer:'IA via servidor Netlify', modeDirect:'IA com chave própria', modeLocal:'Leitura local (sem IA)', extraction:'Extração',
    reading:'Lendo o arquivo', sending:'Enviando para análise', extracting:'Extraindo dados', chars:'caracteres recebidos', parsing:'Interpretando o texto',
    reportData:'Dados do laudo', patient:'Cliente', reportDate:'Data do laudo', lab:'Laboratório', practitioner:'Profissional', files:'Arquivos', journeyStart:'Início da jornada',
    summary:'Resumo', biomarkers:'Biomarcadores', marker:'Marcador', value:'Resultado', ref:'Referência', status:'Status',
    s_low:'Baixo', s_normal:'Normal', s_high:'Alto', s_unknown:'—',
    noBiomarkers:'Nenhum biomarcador identificado no documento.',
    reviewData:'Revisar dados', confirmData:'Confirmar dados do laudo', confirmed:'Confirmado',
    needReview:'Revise os dados extraídos e confirme para liberar as próximas etapas.',
    supplements:'Suplementos', schedule:'Cronograma diário', dose:'Dose', form:'Forma', frequency:'Frequência', timing:'Horário', duration:'Duração', ongoing:'Contínuo', instructions:'Instruções', rationale:'Objetivo',
    noSupp:'Nenhum suplemento encontrado no laudo.', noPep:'Nenhum peptídeo encontrado no laudo.',
    readProtocol:'Li e compreendi este protocolo', editData:'Editar dados',
    peptides:'Peptídeos', cycles:'Linha do tempo dos ciclos', route:'Via', startD:'Início', endD:'Término', cycleLen:'Ciclo', dayOf:'Dia {a} de {b}', everyN:'A cada {n} dias', reconstitution:'Reconstituição',
    p_active:'Ativo', p_sched:'Agendado', p_done:'Concluído', p_tbd:'Término não definido',
    tbdWarn:'Um ou mais peptídeos não têm data de término no laudo. Defina a duração do ciclo em "Editar dados".',
    r_subcutaneous:'Subcutânea', r_intramuscular:'Intramuscular', r_oral:'Oral', r_sublingual:'Sublingual', r_nasal:'Nasal', r_topical:'Tópica', r_other:'Outra',
    slot_wake:'Ao acordar', slot_breakfast:'Café da manhã', slot_lunch:'Almoço', slot_afternoon:'Tarde', slot_dinner:'Jantar', slot_bedtime:'Antes de dormir',
    dow:['D','S','T','Q','Q','S','S'], dowLong:['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'],
    week:'Sem', todayL:'Hoje', fuMarker:'Follow-up', legendActive:'Em curso', legendPast:'Concluído', legendFuture:'Agendado',
    followups:'Follow-ups', fuEvery:'Agendados a cada 30 dias a partir do início da jornada.',
    fuN:'Follow-up {n}', fuTime:'Horário', addCal:'Baixar convite (.ics)', gcal:'Google Agenda', markDone:'Marcar como realizado', undo:'Desfazer', done:'Realizado', allIcs:'Baixar todos (.ics)',
    confirmAgenda:'Confirmar agenda', fuNotes:'Orientações do laudo para o follow-up',
    todayPanel:'Doses do dia', noDoses:'Nenhuma dose programada para este dia.', lockedToday:'As doses aparecem aqui depois que os dados do laudo forem confirmados.',
    futureDay:'Dia futuro — o registro abre na data.', dayComplete:'Dia completo', supp:'Suplemento', pep:'Peptídeo', of:'de',
    // editor
    editorTitle:'Revisão dos dados extraídos', editorSub:'Corrija o que for necessário. Tudo o que for salvo aqui alimenta as 4 etapas.',
    save:'Salvar e confirmar', cancel:'Cancelar', close:'Fechar', add:'Adicionar', remove:'Remover',
    name:'Nome', dob:'Nascimento', sex:'Sexo', pid:'ID', weekdays:'Dias da semana', slots:'Horários', startDate:'Data de início', endDate:'Data de término', durationDays:'Duração (dias)', cycleDays:'Ciclo (dias)', everyNLabel:'A cada N dias (0 = usar dias da semana)', unit:'Unidade', refRange:'Referência',
    startHint:'Em branco = início da jornada',
    // settings
    settingsTitle:'Configurações', extractionMode:'Modo de extração',
    mServerD:'Recomendado. A chave da API fica protegida no Netlify (variável ANTHROPIC_API_KEY).',
    mDirectD:'Para uso interno. A chave fica salva neste navegador e é enviada diretamente à Anthropic.',
    mLocalD:'Funciona sem internet e sem custo. Lê PDFs com texto; a precisão depende do formato do laudo.',
    passcode:'Código de acesso (APP_PASSCODE)', apiKey:'Chave da API Anthropic', model:'Modelo',
    data:'Dados', exportJson:'Exportar backup (.json)', importJson:'Importar backup', deleteClient:'Excluir cliente atual', clearAll:'Apagar todos os dados',
    confirmDelete:'Excluir este cliente e todo o histórico?', confirmClear:'Apagar todos os clientes deste navegador?',
    clientName:'Nome do cliente', create:'Criar', newClientTitle:'Novo cliente',
    levelUp:'Novo nível', levelUpText:'Você chegou ao nível {n}: {name}.', continue:'Continuar',
    badgeNew:'Conquista: {b}', imported:'Backup importado.', exported:'Backup exportado.',
    errNoFunction:'A função /api/extract não foi encontrada. Publique com o Netlify CLI ou Git (o Netlify Drop publica apenas arquivos estáticos) ou mude o modo de extração.',
    errNoKey:'O servidor não tem a variável ANTHROPIC_API_KEY configurada no Netlify.', errAuth:'Código de acesso inválido. Confira em Configurações.',
    errSize:'Arquivo acima de 10 MB.', errType:'Formato não suportado. Use PDF, JPG, PNG ou TXT.', errDirectKey:'Informe a chave da API em Configurações.',
    errEmpty:'Não foi possível extrair dados deste arquivo.', errTrunc:'A resposta foi interrompida. Tente novamente.', errLocalImg:'A leitura local aceita apenas PDF com texto ou TXT. Para imagens, use um modo com IA.',
    errGeneric:'Falha na extração ({s}).', tryLocal:'Tentar leitura local', openSettings:'Abrir configurações',
    demoNote:'Dados fictícios para demonstração.', demoName:'Cliente demonstração',
    storageError:'Não foi possível salvar no navegador.',
    whatsappNum:'WhatsApp (com código do país)', waPh:'+971 50 123 4567', waTo:'Enviar para', waMissing:'Cadastre o WhatsApp do cliente para abrir a conversa direto. Sem número, você escolhe o contato no WhatsApp.', waInvalid:'Número inválido. Use o código do país, ex.: +55 62 99999-9999.',
    shop:'Supplement shop', fitline:'FitLine', links:'Links do cliente', shopUrlL:'Link da loja de suplementos', fitlineUrlL:'Link FitLine',
    fitlineTitle:'Enviar link FitLine', fitlineEmpty:'Cole o link FitLine que será enviado ao cliente. Ele fica salvo para os próximos envios.', fitlineHint:'O mesmo link vale para todos os clientes; altere quando precisar. O cliente recebe um endereço RegeneCure que redireciona para este link.',
    openLink:'Abrir', copyLink:'Copiar link', whatsapp:'WhatsApp', email:'E-mail', copied:'Link copiado.', sentAt:'Último envio para este cliente: {d}', notSent:'Ainda não enviado para este cliente.', invalidUrl:'Informe um link válido.',
    fitlineMsg:'Olá, {name}. Segue o link FitLine indicado no seu protocolo: {url}', fitlineSubject:'Seu link FitLine — RegeneCure'
  },
  en:{
    newClient:'New client', settings:'Settings', welcomeKicker:'Client journey',
    welcomeTitle:'Every protocol, tracked from report to follow-up',
    welcomeText:'Create a client and upload the report. Lab results, supplements, peptides and follow-ups are extracted from the document and organised into 4 stages.',
    createClient:'Create client', loadDemo:'View demo',
    stage1:'Report', stage2:'Supplements', stage3:'Peptides', stage4:'Follow-up',
    stage1Long:'Blood work report', stage2Long:'Supplements and schedule', stage3Long:'Peptides and cycles', stage4Long:'Upcoming follow-ups',
    stDone:'Completed', stActive:'In progress', stLocked:'Awaiting report', stReview:'Review',
    journeyDay:'Day {n} of the journey', startsIn:'Starts in {n} days', notStarted:'Journey not started', started:'Start',
    level:'Level', xpTo:'{x} XP to level {n}', maxLevel:'Highest level reached',
    streak:'Streak', days:'days', day:'day', adherence:'Adherence', nextFU:'Next follow-up', inDays:'in {n} days', today:'today', overdue:'{n} days ago',
    dosesLogged:'Doses logged', fullDays:'full days',
    lv:['Foundation','Consistency','Adaptation','Regeneration','Longevity','Mastery'],
    b_baseline:'Baseline set', b_protocol:'Protocol understood', b_calendar:'Schedule set', b_streak7:'7 consistent days', b_streak21:'21 consistent days', b_adh90:'Adherence above 90%', b_cycle:'Cycle completed', b_fu1:'First follow-up',
    uploadTitle:'Upload the report', uploadText:'Drag the report PDF or image here, or', choose:'choose a file', uploadTypes:'PDF, JPG, PNG or TXT · up to 10 MB',
    replace:'Replace report', addDoc:'Add document',
    addDocHint:'Use "Add document" when the protocol sits in a separate file from the lab results — the data is merged.',
    privacy:'Data is stored only in this browser. In AI mode, the file is sent to the Anthropic API for extraction.',
    modeServer:'AI via Netlify server', modeDirect:'AI with own key', modeLocal:'Local reading (no AI)', extraction:'Extraction',
    reading:'Reading the file', sending:'Sending for analysis', extracting:'Extracting data', chars:'characters received', parsing:'Parsing the text',
    reportData:'Report data', patient:'Client', reportDate:'Report date', lab:'Laboratory', practitioner:'Practitioner', files:'Files', journeyStart:'Journey start',
    summary:'Summary', biomarkers:'Biomarkers', marker:'Marker', value:'Result', ref:'Reference', status:'Status',
    s_low:'Low', s_normal:'Normal', s_high:'High', s_unknown:'—',
    noBiomarkers:'No biomarkers identified in the document.',
    reviewData:'Review data', confirmData:'Confirm report data', confirmed:'Confirmed',
    needReview:'Review the extracted data and confirm to open the next stages.',
    supplements:'Supplements', schedule:'Daily schedule', dose:'Dose', form:'Form', frequency:'Frequency', timing:'Timing', duration:'Duration', ongoing:'Ongoing', instructions:'Instructions', rationale:'Purpose',
    noSupp:'No supplements found in the report.', noPep:'No peptides found in the report.',
    readProtocol:'I have read and understood this protocol', editData:'Edit data',
    peptides:'Peptides', cycles:'Cycle timeline', route:'Route', startD:'Start', endD:'End', cycleLen:'Cycle', dayOf:'Day {a} of {b}', everyN:'Every {n} days', reconstitution:'Reconstitution',
    p_active:'Active', p_sched:'Scheduled', p_done:'Completed', p_tbd:'End not defined',
    tbdWarn:'One or more peptides have no end date in the report. Set the cycle length in "Edit data".',
    r_subcutaneous:'Subcutaneous', r_intramuscular:'Intramuscular', r_oral:'Oral', r_sublingual:'Sublingual', r_nasal:'Nasal', r_topical:'Topical', r_other:'Other',
    slot_wake:'Upon waking', slot_breakfast:'Breakfast', slot_lunch:'Lunch', slot_afternoon:'Afternoon', slot_dinner:'Dinner', slot_bedtime:'Bedtime',
    dow:['S','M','T','W','T','F','S'], dowLong:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    week:'W', todayL:'Today', fuMarker:'Follow-up', legendActive:'Running', legendPast:'Completed', legendFuture:'Scheduled',
    followups:'Follow-ups', fuEvery:'Scheduled every 30 days from the journey start.',
    fuN:'Follow-up {n}', fuTime:'Time', addCal:'Download invite (.ics)', gcal:'Google Calendar', markDone:'Mark as completed', undo:'Undo', done:'Completed', allIcs:'Download all (.ics)',
    confirmAgenda:'Confirm schedule', fuNotes:'Follow-up guidance from the report',
    todayPanel:'Doses for the day', noDoses:'No doses scheduled for this day.', lockedToday:'Doses appear here once the report data is confirmed.',
    futureDay:'Future day — logging opens on the date.', dayComplete:'Day completed', supp:'Supplement', pep:'Peptide', of:'of',
    editorTitle:'Review extracted data', editorSub:'Correct anything needed. Everything saved here feeds the 4 stages.',
    save:'Save and confirm', cancel:'Cancel', close:'Close', add:'Add', remove:'Remove',
    name:'Name', dob:'Date of birth', sex:'Sex', pid:'ID', weekdays:'Weekdays', slots:'Timing', startDate:'Start date', endDate:'End date', durationDays:'Duration (days)', cycleDays:'Cycle (days)', everyNLabel:'Every N days (0 = use weekdays)', unit:'Unit', refRange:'Reference',
    startHint:'Blank = journey start',
    settingsTitle:'Settings', extractionMode:'Extraction mode',
    mServerD:'Recommended. The API key stays protected on Netlify (ANTHROPIC_API_KEY variable).',
    mDirectD:'Internal use. The key is saved in this browser and sent directly to Anthropic.',
    mLocalD:'Works offline at no cost. Reads text PDFs; accuracy depends on the report layout.',
    passcode:'Access code (APP_PASSCODE)', apiKey:'Anthropic API key', model:'Model',
    data:'Data', exportJson:'Export backup (.json)', importJson:'Import backup', deleteClient:'Delete current client', clearAll:'Erase all data',
    confirmDelete:'Delete this client and all history?', confirmClear:'Erase every client in this browser?',
    clientName:'Client name', create:'Create', newClientTitle:'New client',
    levelUp:'New level', levelUpText:'You reached level {n}: {name}.', continue:'Continue',
    badgeNew:'Achievement: {b}', imported:'Backup imported.', exported:'Backup exported.',
    errNoFunction:'The /api/extract function was not found. Deploy with the Netlify CLI or Git (Netlify Drop publishes static files only) or change the extraction mode.',
    errNoKey:'The server has no ANTHROPIC_API_KEY variable set on Netlify.', errAuth:'Invalid access code. Check Settings.',
    errSize:'File larger than 10 MB.', errType:'Unsupported format. Use PDF, JPG, PNG or TXT.', errDirectKey:'Enter the API key in Settings.',
    errEmpty:'No data could be extracted from this file.', errTrunc:'The response was cut off. Try again.', errLocalImg:'Local reading accepts only text PDFs or TXT. For images, use an AI mode.',
    errGeneric:'Extraction failed ({s}).', tryLocal:'Try local reading', openSettings:'Open settings',
    demoNote:'Fictitious data for demonstration.', demoName:'Demo client',
    storageError:'Could not save in the browser.',
    whatsappNum:'WhatsApp (with country code)', waPh:'+971 50 123 4567', waTo:'Send to', waMissing:'Add the client\'s WhatsApp to open the chat directly. Without a number, you pick the contact in WhatsApp.', waInvalid:'Invalid number. Include the country code, e.g. +971 50 123 4567.',
    shop:'Supplement shop', fitline:'FitLine', links:'Client links', shopUrlL:'Supplement shop link', fitlineUrlL:'FitLine link',
    fitlineTitle:'Send FitLine link', fitlineEmpty:'Paste the FitLine link to send to the client. It stays saved for future sends.', fitlineHint:'The same link applies to every client; change it whenever needed. The client receives a RegeneCure address that redirects to this link.',
    openLink:'Open', copyLink:'Copy link', whatsapp:'WhatsApp', email:'Email', copied:'Link copied.', sentAt:'Last sent to this client: {d}', notSent:'Not yet sent to this client.', invalidUrl:'Enter a valid link.',
    fitlineMsg:'Hello {name}, here is the FitLine link recommended in your protocol: {url}', fitlineSubject:'Your FitLine link — RegeneCure'
  }
};
function t(k, vars){ let s = (I18N[S.lang]||I18N.en)[k]; if(s===undefined) s = I18N.en[k] ?? k; if(vars && typeof s==='string') for(const v in vars) s = s.replace('{'+v+'}', vars[v]); return s; }


/* Strings added for the two-interface version */
Object.assign(I18N.pt, {
  privacy:'O arquivo fica no armazenamento privado do projeto (Supabase). No modo IA, ele é enviado à API da Anthropic para extração.',
  loginTitle:'Acesso da profissional', email:'E-mail', password:'Senha', signIn:'Entrar', signOut:'Sair', loginErr:'E-mail ou senha incorretos.', notAdmin:'Esta conta não tem permissão de administradora.', loading:'Carregando…',
  clients:'Clientes', search:'Buscar cliente', colClient:'Cliente', colStatus:'Status', colDay:'Jornada', colAdh:'Adesão 7 dias', colNext:'Próximo follow-up', colSeen:'Último acesso', never:'Nunca',
  st_draft:'Rascunho', st_published:'Publicado', st_archived:'Arquivado', noClients:'Nenhum cliente ainda. Crie o primeiro e envie o laudo.', backList:'Clientes', dayN:'Dia {n}',
  publishSend:'Publicar e enviar no WhatsApp', resend:'Reenviar link no WhatsApp', publishOnly:'Publicar sem enviar', copyClientLink:'Copiar link do cliente', previewClient:'Ver como cliente',
  rotate:'Gerar novo link', rotateConfirm:'O link atual e os acessos já feitos deixam de funcionar. Continuar?', unpublish:'Despublicar', deleteClient:'Excluir cliente', confirmDelete:'Excluir este cliente e todo o histórico?',
  sentOk:'Mensagem enviada no WhatsApp.', needReviewFirst:'Revise e confirme os dados do laudo antes de publicar.', needWa:'Cadastre o WhatsApp do cliente para enviar.',
  publishedOn:'Publicado em {d}', lastSentOn:'Último envio: {d}', lastSeenOn:'Último acesso do cliente: {d}', notSeen:'O cliente ainda não acessou.', linkCopied:'Link do cliente copiado.', saveErr:'Falha ao salvar. Verifique a conexão.',
  clientLang:'Idioma do cliente', waitingClient:'Aguardando o cliente', clientConfirmed:'Cliente confirmou', sendReminder:'Enviar lembrete no WhatsApp', reminderSent:'Lembrete enviado', adminTodayNote:'Doses que o cliente marcou neste dia.',
  e_whatsapp_not_configured:'O WhatsApp ainda não está configurado no Netlify (variável KAPSO_API_KEY).', e_send_failed:'O WhatsApp recusou o envio. Confira se o template está aprovado. Detalhe: {d}', e_not_reviewed:'Revise e confirme os dados do laudo antes de enviar.', e_no_whatsapp:'Cadastre o WhatsApp do cliente.', e_missing_supabase_secret:'Falta a variável SUPABASE_SECRET_KEY no Netlify.', e_not_published:'Publique a jornada antes de enviar lembretes.', e_missing_waba_id:'Falta a variável KAPSO_WABA_ID no Netlify.', e_kapso_timeout:'O Kapso demorou a responder. Tente novamente.', e_kapso_error:'O Kapso recusou a consulta: {d}', e_http_502:'O servidor interrompeu a operação. Tente novamente.', e_generic:'Erro: {d}',
  setupStatus:'Status da configuração', ok:'OK', missing:'Pendente', waTemplates:'Templates do WhatsApp', createTemplates:'Criar templates no WhatsApp', checkTemplates:'Verificar status', templatesHint:'Cria os 6 templates (3 em português, 3 em inglês) na sua conta WhatsApp pelo Kapso. A Meta revisa cada um antes de liberar.',
  autoReminders:'Lembrete automático no WhatsApp 1 dia antes de cada follow-up', importOld:'Importar backup da versão anterior (.json)', importedN:'{n} clientes importados.', extractionMode:'Modo de extração',
  mServerD:'Recomendado. Usa a IA pelo servidor Netlify (variável ANTHROPIC_API_KEY).', fitlineVisible:'Mostrar o botão FitLine no painel deste cliente',
  cl_title:'Seu painel RegeneCure', cl_intro:'Para proteger os seus dados, o acesso é confirmado por um código enviado ao seu WhatsApp.', cl_send:'Receber código no WhatsApp',
  cl_codeSent:'Enviamos um código de 6 dígitos para {to}. Ele vale por {m} minutos.', cl_code:'Código de 6 dígitos', cl_enter:'Entrar', cl_resend:'Enviar novo código', cl_wait:'Aguarde alguns segundos para pedir um novo código.',
  cl_wrong:'Código incorreto. Restam {n} tentativas.', cl_expired:'Código expirado. Peça um novo.', cl_tooMany:'Muitas tentativas. Tente novamente em 15 minutos.', cl_notFound:'Link inválido ou desativado. Fale com a sua profissional.',
  cl_noWa:'Não há WhatsApp cadastrado para este acesso. Fale com a sua profissional.', cl_sendFail:'Não foi possível enviar o código agora. Tente novamente em alguns minutos.', cl_logout:'Sair deste aparelho',
  cl_previewBanner:'Pré-visualização da profissional — as marcações não são salvas.', cl_report:'Baixar laudo', cl_offline:'Sem conexão. A marcação não foi salva.', cl_byline:'RegeneCure · Dr. Maisa Ribeiro, PhD',
  flSendWa:'Enviar pelo WhatsApp Business', flTo:'O link será enviado pela plataforma para o WhatsApp {n}.', flLastSent:'Último envio: {d}', flLastClick:'Cliente abriu o link: {d} ({n} acesso(s))', flNoClick:'O cliente ainda não abriu o link.', e_no_fitline_url:'Informe o link FitLine antes de enviar.', winOpen:'Janela aberta até {d} — vai como mensagem normal', winClosed:'Fora da janela de 24 h — será enviado como template de marketing', winLast:'(última mensagem do cliente: {d})', winUnknown:'Janela de 24 h desconhecida — configure o webhook do Kapso',
  pepAlertTitle:'Lembrete diário dos peptídeos no WhatsApp', pepAlertDesc:'Receba uma mensagem nos dias de aplicação, no horário escolhido.', pepAlertTime:'Horário', pepAlertOn:'Ativo · {h}', pepAlertOff:'Desativado pelo cliente', pepAlertSaved:'Lembrete diário ativado para {h}.', pepAlertDisabled:'Lembrete diário desativado.',
  attAsk:'Você confirma a sua presença neste follow-up?', attConfirmBtn:'Confirmar presença', attRescheduleBtn:'Preciso remarcar', attDoneConfirmed:'Presença confirmada. Obrigado.', attDoneReschedule:'Pedido de remarcação registrado. A equipe RegeneCure entrará em contato.',
  attConfirmed:'Presença confirmada', attReschedule:'Pediu remarcação', attWaiting:'Aguardando confirmação do cliente',
  pepSchedule:'Cronograma diário dos peptídeos', pushTitle:'Lembrete diário no celular', pushDesc:'Receba uma notificação nos dias de aplicação, no horário escolhido.', pushOnDesc:'Ativo neste aparelho. Aviso às {h} nos dias de aplicação.', pushDevices:'{n} aparelho(s)',
  pepIcs:'Prefere o calendário do celular? Adicionar lembretes (.ics)', pushUnsupported:'Este navegador não permite notificações. Use os lembretes no calendário.', pushDenied:'As notificações foram bloqueadas. Libere nas configurações do navegador e tente de novo.', pushOff:'Lembrete diário desativado.', pushFail:'Não foi possível ativar as notificações agora. Tente novamente.',
  iosTitle:'Ativar notificações no iPhone', iosStep1:'Toque em Compartilhar (o quadrado com a seta para cima) na barra do Safari.', iosStep2:'Escolha Adicionar à Tela de Início e confirme.', iosStep3:'Abra o painel pelo novo ícone RegeneCure na Tela de Início.', iosStep4:'Entre com o código do WhatsApp e ative o lembrete na etapa Peptídeos.', iosNote:'É uma exigência da Apple: notificações de sites só funcionam a partir da Tela de Início (iOS 16.4 ou mais recente). Se preferir, use os lembretes no calendário.', iosOk:'Entendi', peptideAlertsGlobal:'Lembretes diários de peptídeos por notificação no celular (para clientes com o lembrete ativo)'
});
Object.assign(I18N.en, {
  privacy:'The file is kept in the project\'s private storage (Supabase). In AI mode, it is sent to the Anthropic API for extraction.',
  loginTitle:'Practitioner access', email:'Email', password:'Password', signIn:'Sign in', signOut:'Sign out', loginErr:'Incorrect email or password.', notAdmin:'This account does not have administrator access.', loading:'Loading…',
  clients:'Clients', search:'Search client', colClient:'Client', colStatus:'Status', colDay:'Journey', colAdh:'7-day adherence', colNext:'Next follow-up', colSeen:'Last access', never:'Never',
  st_draft:'Draft', st_published:'Published', st_archived:'Archived', noClients:'No clients yet. Create the first one and upload the report.', backList:'Clients', dayN:'Day {n}',
  publishSend:'Publish and send on WhatsApp', resend:'Resend link on WhatsApp', publishOnly:'Publish without sending', copyClientLink:'Copy client link', previewClient:'View as client',
  rotate:'Generate new link', rotateConfirm:'The current link and existing sign-ins will stop working. Continue?', unpublish:'Unpublish', deleteClient:'Delete client', confirmDelete:'Delete this client and all history?',
  sentOk:'Message sent on WhatsApp.', needReviewFirst:'Review and confirm the report data before publishing.', needWa:'Add the client\'s WhatsApp to send.',
  publishedOn:'Published on {d}', lastSentOn:'Last sent: {d}', lastSeenOn:'Client\'s last access: {d}', notSeen:'The client has not accessed yet.', linkCopied:'Client link copied.', saveErr:'Save failed. Check the connection.',
  clientLang:'Client language', waitingClient:'Waiting for the client', clientConfirmed:'Client confirmed', sendReminder:'Send WhatsApp reminder', reminderSent:'Reminder sent', adminTodayNote:'Doses the client ticked on this day.',
  e_whatsapp_not_configured:'WhatsApp is not configured on Netlify yet (KAPSO_API_KEY variable).', e_send_failed:'WhatsApp rejected the message. Check that the template is approved. Detail: {d}', e_not_reviewed:'Review and confirm the report data before sending.', e_no_whatsapp:'Add the client\'s WhatsApp.', e_missing_supabase_secret:'The SUPABASE_SECRET_KEY variable is missing on Netlify.', e_not_published:'Publish the journey before sending reminders.', e_missing_waba_id:'The KAPSO_WABA_ID variable is missing on Netlify.', e_kapso_timeout:'Kapso took too long to respond. Try again.', e_kapso_error:'Kapso rejected the request: {d}', e_http_502:'The server stopped the operation. Try again.', e_generic:'Error: {d}',
  setupStatus:'Setup status', ok:'OK', missing:'Pending', waTemplates:'WhatsApp templates', createTemplates:'Create WhatsApp templates', checkTemplates:'Check status', templatesHint:'Creates the 6 templates (3 in Portuguese, 3 in English) in your WhatsApp account through Kapso. Meta reviews each one before release.',
  autoReminders:'Automatic WhatsApp reminder 1 day before each follow-up', importOld:'Import backup from the previous version (.json)', importedN:'{n} clients imported.', extractionMode:'Extraction mode',
  mServerD:'Recommended. Uses AI through the Netlify server (ANTHROPIC_API_KEY variable).', fitlineVisible:'Show the FitLine button on this client\'s dashboard',
  cl_title:'Your RegeneCure dashboard', cl_intro:'To protect your data, access is confirmed with a code sent to your WhatsApp.', cl_send:'Send code to WhatsApp',
  cl_codeSent:'We sent a 6-digit code to {to}. It is valid for {m} minutes.', cl_code:'6-digit code', cl_enter:'Sign in', cl_resend:'Send a new code', cl_wait:'Wait a few seconds before requesting a new code.',
  cl_wrong:'Incorrect code. {n} attempts left.', cl_expired:'Code expired. Request a new one.', cl_tooMany:'Too many attempts. Try again in 15 minutes.', cl_notFound:'Invalid or disabled link. Contact your practitioner.',
  cl_noWa:'No WhatsApp number is registered for this access. Contact your practitioner.', cl_sendFail:'The code could not be sent right now. Try again in a few minutes.', cl_logout:'Sign out on this device',
  cl_previewBanner:'Practitioner preview — ticks are not saved.', cl_report:'Download report', cl_offline:'No connection. The tick was not saved.', cl_byline:'RegeneCure · Dr. Maisa Ribeiro, PhD',
  flSendWa:'Send via WhatsApp Business', flTo:'The platform will send the link to WhatsApp {n}.', flLastSent:'Last sent: {d}', flLastClick:'Client opened the link: {d} ({n} visit(s))', flNoClick:'The client has not opened the link yet.', e_no_fitline_url:'Enter the FitLine link before sending.', winOpen:'Window open until {d} — goes as a regular message', winClosed:'Outside the 24 h window — will be sent as a marketing template', winLast:'(client\'s last message: {d})', winUnknown:'24 h window unknown — set up the Kapso webhook',
  pepAlertTitle:'Daily peptide reminder on WhatsApp', pepAlertDesc:'Get a message on dosing days, at the time you choose.', pepAlertTime:'Time', pepAlertOn:'Active · {h}', pepAlertOff:'Turned off by the client', pepAlertSaved:'Daily reminder on for {h}.', pepAlertDisabled:'Daily reminder turned off.',
  attAsk:'Do you confirm your attendance at this follow-up?', attConfirmBtn:'Confirm attendance', attRescheduleBtn:'I need to reschedule', attDoneConfirmed:'Attendance confirmed. Thank you.', attDoneReschedule:'Reschedule request recorded. The RegeneCure team will contact you.',
  attConfirmed:'Attendance confirmed', attReschedule:'Asked to reschedule', attWaiting:'Waiting for the client to confirm',
  pepSchedule:'Daily peptide schedule', pushTitle:'Daily reminder on your phone', pushDesc:'Get a notification on dosing days, at the time you choose.', pushOnDesc:'On for this device. Reminder at {h} on dosing days.', pushDevices:'{n} device(s)',
  pepIcs:'Prefer your phone calendar? Add reminders (.ics)', pushUnsupported:'This browser does not allow notifications. Use the calendar reminders.', pushDenied:'Notifications are blocked. Allow them in the browser settings and try again.', pushOff:'Daily reminder turned off.', pushFail:'Notifications could not be turned on right now. Try again.',
  iosTitle:'Turn on notifications on iPhone', iosStep1:'Tap Share (the square with an up arrow) in the Safari bar.', iosStep2:'Choose Add to Home Screen and confirm.', iosStep3:'Open the dashboard from the new RegeneCure icon on the Home Screen.', iosStep4:'Sign in with the WhatsApp code and turn on the reminder in the Peptides stage.', iosNote:'This is an Apple requirement: website notifications only work from the Home Screen (iOS 16.4 or later). You can also use the calendar reminders.', iosOk:'Got it', peptideAlertsGlobal:'Daily peptide reminders as phone notifications (for clients with the reminder on)'
});

/* ---------- Icons ---------- */
const IC = {
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  pill:'<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  syringe:'<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  check:'<polyline points="20 6 9 17 4 12"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  pulse:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  award:'<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  left:'<polyline points="15 18 9 12 15 6"/>', right:'<polyline points="9 18 15 12 9 6"/>',
  x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  trash:'<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  send:'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  eye:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  refresh:'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  search:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bell:'<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'
};
const ic = (n, cls='i') => `<svg class="${cls}" viewBox="0 0 24 24">${IC[n]||''}</svg>`;

/* ---------- Utils ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2,'0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s||''); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; };
const validISO = s => parseISO(s) ? String(s).slice(0,10) : '';
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate()+n); return iso(d); };
const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);
const todayISO = () => iso(new Date());
const dowOf = s => parseISO(s).getDay();
const posInt = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const locale = () => S.lang === 'pt' ? 'pt-BR' : 'en-GB';
function fmtDate(s, o){ const d = parseISO(s); return d ? d.toLocaleDateString(locale(), o || {day:'2-digit', month:'short', year:'numeric'}) : '—'; }
function fmtShort(s){ return fmtDate(s, {day:'2-digit', month:'short'}); }

const ui = { stage:null, day:todayISO(), busy:false, progress:'', error:null, errorKind:null };
let editorDraft = null;

/* ---------- Normalisation ---------- */
const DAYMAP = {sun:0,sunday:0,dom:0,domingo:0,mon:1,monday:1,seg:1,segunda:1,tue:2,tuesday:2,ter:2,terca:2,'terça':2,wed:3,wednesday:3,qua:3,quarta:3,thu:4,thursday:4,qui:4,quinta:4,fri:5,friday:5,sex:5,sexta:5,sat:6,saturday:6,sab:6,'sáb':6,sabado:6,'sábado':6};
function deriveSchedule(freq, start){
  const f = (freq||'').toLowerCase();
  if(/every other day|alternate|alternad|\beod\b|a cada 2 dias|cada 48/.test(f)) return {days:ALL_DAYS.slice(), everyN:2};
  const ev = /(?:every|a cada|cada)\s*(\d+)\s*(?:days|dias|d\b)/.exec(f);
  if(ev && +ev[1] > 1) return {days:ALL_DAYS.slice(), everyN:+ev[1]};
  if(/(week|semana|\/\s*wk|\/\s*sem|semanal)/.test(f)){
    const m = /(\d)\s*(?:x|times|vezes|×)/.exec(f) || /(twice|duas)/.exec(f);
    const k = m ? (/(twice|duas)/.test(m[0]) ? 2 : +m[1]) : 1;
    const map = {1:[start ? dowOf(start) : 1], 2:[1,4], 3:[1,3,5], 4:[1,2,4,5], 5:[1,2,3,4,5], 6:[1,2,3,4,5,6], 7:ALL_DAYS.slice()};
    return {days:map[k] || ALL_DAYS.slice(), everyN:0};
  }
  if(/5\s*(?:on|dias on)|mon(?:day)?\s*(?:-|–|to)\s*fri|seg\w*\s*(?:-|–|a|à)\s*sex|weekdays|dias úteis|dias uteis/.test(f)) return {days:[1,2,3,4,5], everyN:0};
  return {days:ALL_DAYS.slice(), everyN:0};
}
function normDays(arr, freq, start, everyN){
  if(posInt(everyN) > 1) return {days:ALL_DAYS.slice(), everyN:posInt(everyN)};
  if(Array.isArray(arr) && arr.length){
    const out = [...new Set(arr.map(x => typeof x === 'number' ? x : (DAYMAP[String(x).toLowerCase()] ?? DAYMAP[String(x).toLowerCase().slice(0,3)])).filter(x => x !== undefined && x !== null))].sort((a,b)=>a-b);
    if(out.length) return {days:out, everyN:0};
  }
  return deriveSchedule(freq, start);
}
function deriveSlots(text, kind){
  const f = (text||'').toLowerCase(); const s = new Set();
  if(/(acordar|waking|wake|upon rising|jejum|fasting|empty stomach|estômago vazio|estomago vazio)/.test(f)) s.add('wake');
  if(/(breakfast|café da manh|cafe da manh|morning|manhã|manha)/.test(f)) s.add('breakfast');
  if(/(lunch|almoço|almoco|midday|meio-dia|meio dia)/.test(f)) s.add('lunch');
  if(/(afternoon|tarde|pre-?workout|pré-?treino|pre-?treino)/.test(f)) s.add('afternoon');
  if(/(dinner|jantar|evening|\bnoite\b)/.test(f)) s.add('dinner');
  if(/(bedtime|before bed|antes de dormir|\bnight\b|ao deitar|before sleep)/.test(f)) s.add('bedtime');
  if(!s.size){
    if(/(3\s*x|3\s*times|three times|\btid\b|3\s*vezes)/.test(f) && !/(week|semana)/.test(f)) ['breakfast','lunch','dinner'].forEach(x=>s.add(x));
    else if(/(2\s*x|twice|\bbid\b|2\s*vezes|duas vezes)/.test(f) && !/(week|semana)/.test(f)) ['breakfast','dinner'].forEach(x=>s.add(x));
    else s.add(kind === 'pep' ? 'wake' : 'breakfast');
  }
  return SLOTS.filter(x => s.has(x));
}
function normSlots(arr, text, kind){
  if(Array.isArray(arr) && arr.length){ const out = SLOTS.filter(s => arr.includes(s)); if(out.length) return out; }
  return deriveSlots(text, kind);
}
function normSupp(x, js){
  const start = validISO(x.start_date ?? x.start);
  const sch = normDays(x.days_of_week ?? x.days, x.frequency, start || js, x.every_n_days ?? x.everyN);
  return { id:x.id || uid(), name:x.name||'', dose:x.dose||'', form:x.form||'', frequency:x.frequency||'',
    slots:normSlots(x.timing ?? x.slots, [x.frequency, x.instructions].join(' '), 'supp'), days:sch.days, everyN:sch.everyN,
    start, durationDays:posInt(x.duration_days ?? x.durationDays), instructions:x.instructions||'', rationale:x.rationale||'' };
}
const ROUTES = ['subcutaneous','intramuscular','oral','sublingual','nasal','topical','other'];
function normRoute(r){
  const v = (r||'').toLowerCase();
  if(ROUTES.includes(v)) return v;
  if(/(sc|subc|subq|s\.c|subcut)/.test(v)) return 'subcutaneous';
  if(/(im\b|intramus|i\.m)/.test(v)) return 'intramuscular';
  if(/(subling)/.test(v)) return 'sublingual';
  if(/(oral|\bvo\b|caps|tablet|strip)/.test(v)) return 'oral';
  if(/(nasal)/.test(v)) return 'nasal';
  if(/(topic|tópic|cream|creme)/.test(v)) return 'topical';
  return v ? 'other' : 'subcutaneous';
}
function normPep(x, js){
  let start = validISO(x.start_date ?? x.start);
  const off = Number.isInteger(x.start_offset_days) ? x.start_offset_days : null;
  if(!start && off !== null && js) start = addDays(js, off);
  const end = validISO(x.end_date ?? x.end);
  let cycleDays = posInt(x.cycle_length_days ?? x.cycleDays);
  if(start && end && !cycleDays) cycleDays = diffDays(end, start) + 1;
  const sch = normDays(x.days_of_week ?? x.days, x.frequency, start || js, x.every_n_days ?? x.everyN);
  return { id:x.id || uid(), name:x.name||'', dose:x.dose||'', route:normRoute(x.route), frequency:x.frequency||'',
    slots:normSlots(x.timing ?? x.slots, [x.frequency, x.instructions].join(' '), 'pep'), days:sch.days, everyN:sch.everyN,
    start, end, cycleDays, reconstitution:x.reconstitution||'', instructions:x.instructions||'', rationale:x.rationale||'' };
}
function normBio(x){
  let status = ['low','normal','high','unknown'].includes(x.status) ? x.status : 'unknown';
  return { id:x.id || uid(), name:x.name||'', value:x.value ?? '', unit:x.unit||'', ref:x.reference_range ?? x.ref ?? '', status };
}
function mergeExtraction(c, d, mode, fileName){
  const p = d.patient || {}, r = d.report || {};
  const fill = (cur, v) => (mode === 'replace' ? (v || cur) : (cur || v)) || '';
  c.patient.name = fill(c.patient.name, p.name); c.patient.dob = fill(c.patient.dob, validISO(p.date_of_birth));
  c.patient.sex = fill(c.patient.sex, p.sex); c.patient.patientId = fill(c.patient.patientId, p.patient_id);
  c.patient.whatsapp = c.patient.whatsapp || (waDigits(p.phone) ? p.phone : '');
  const prevFiles = (mode === 'append' && c.report) ? c.report.files : [];
  c.report = { date: fill(c.report?.date, validISO(r.report_date)), lab: fill(c.report?.lab, r.laboratory),
    practitioner: fill(c.report?.practitioner, r.practitioner),
    summary: mode === 'append' && c.report?.summary && r.summary ? c.report.summary + '\n\n' + r.summary : (r.summary || c.report?.summary || ''),
    files:[...prevFiles, fileName], uploadedAt:new Date().toISOString() };
  const js = validISO(d.journey_start_date) || (mode === 'append' ? c.journeyStart : '') || c.journeyStart || todayISO();
  c.journeyStart = js;
  const sup = (d.supplements||[]).filter(x=>x && x.name).map(x => normSupp(x, js));
  const pep = (d.peptides||[]).filter(x=>x && x.name).map(x => normPep(x, js));
  const bio = (d.biomarkers||[]).filter(x=>x && x.name).map(normBio);
  const mergeList = (old, neu) => { const keyed = new Map(old.map(o => [o.name.toLowerCase().trim(), o])); neu.forEach(n => keyed.set(n.name.toLowerCase().trim(), n)); return [...keyed.values()]; };
  if(mode === 'append'){ c.supplements = mergeList(c.supplements, sup); c.peptides = mergeList(c.peptides, pep); c.biomarkers = mergeList(c.biomarkers, bio); }
  else { c.supplements = sup; c.peptides = pep; c.biomarkers = bio; }
  if(d.follow_up_notes) c.followUpNotes = mode === 'append' && c.followUpNotes ? c.followUpNotes + '\n' + d.follow_up_notes : d.follow_up_notes;
  c.confirmed.s1 = false; c.confirmed.s2 = false; c.confirmed.s3 = false;
}

/* ---------- Schedule engine ---------- */
const effStart = (c, it) => it.start || c.journeyStart;
function effEnd(c, it, kind){
  if(kind === 'pep'){ if(it.end) return it.end; if(it.cycleDays) return addDays(effStart(c,it), it.cycleDays - 1); return ''; }
  return it.durationDays ? addDays(effStart(c,it), it.durationDays - 1) : '';
}
function scheduledOn(c, it, kind, date){
  const st = effStart(c, it); if(!st || date < st) return false;
  const en = effEnd(c, it, kind); if(en && date > en) return false;
  if(it.everyN > 1) return diffDays(date, st) % it.everyN === 0;
  return (it.days && it.days.length ? it.days : ALL_DAYS).includes(dowOf(date));
}
function dueItems(c, date){
  if(!c || !c.journeyStart) return [];
  const out = [];
  c.supplements.forEach(s => { if(scheduledOn(c, s, 'supp', date)) (s.slots.length ? s.slots : ['breakfast']).forEach(sl => out.push({key:`${date}|s:${s.id}|${sl}`, kind:'supp', item:s, slot:sl})); });
  c.peptides.forEach(p => { if(scheduledOn(c, p, 'pep', date)) (p.slots.length ? p.slots : ['wake']).forEach(sl => out.push({key:`${date}|p:${p.id}|${sl}`, kind:'pep', item:p, slot:sl})); });
  return out.sort((a,b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
}
function pepStatus(c, p){
  const st = effStart(c,p), en = effEnd(c,p,'pep'), td = todayISO();
  if(td < st) return 'sched';
  if(!en) return 'tbd';
  if(td > en) return 'done';
  return 'active';
}
function followupDates(c){
  if(!c.journeyStart) return [];
  let last = c.journeyStart;
  c.peptides.forEach(p => { const e = effEnd(c,p,'pep'); if(e && e > last) last = e; });
  c.supplements.forEach(s => { const e = effEnd(c,s,'supp'); if(e && e > last) last = e; });
  const span = Math.max(diffDays(last, c.journeyStart), diffDays(todayISO(), c.journeyStart));
  const count = Math.max(3, Math.ceil(span / 30) + 1);
  return Array.from({length:count}, (_, i) => ({ n:i+1, date:addDays(c.journeyStart, 30*(i+1)) }));
}
function nextFollowup(c){ const list = followupDates(c); return list.find(f => !c.followups[f.n]?.done) || null; }

/* ---------- Stats & gamification ---------- */
function computeStats(c){
  const st = { xp:0, checks:0, due:0, fullDays:0, streak:0, best:0, adherence:null, days:[] };
  if(!c) return st;
  st.checks = Object.keys(c.checks).filter(k => c.checks[k]).length;
  const td = todayISO();
  if(c.confirmed.s1 && c.journeyStart && c.journeyStart <= td){
    let run = 0; let done = 0, due = 0;
    for(let d = c.journeyStart; d <= td; d = addDays(d, 1)){
      const items = dueItems(c, d); if(!items.length) continue;
      const k = items.filter(x => c.checks[x.key]).length;
      if(d < td){ due += items.length; done += k; } else { due += k; done += k; }
      const full = k === items.length;
      if(full){ st.fullDays++; run++; st.best = Math.max(st.best, run); }
      else if(d < td){ run = 0; }
    }
    st.streak = run; st.due = due; st.adherence = due ? Math.round(done / due * 100) : null;
    st.elapsed = diffDays(td, c.journeyStart) + 1;
  }
  const confirmedCount = ['s1','s2','s3','s4'].filter(k => c.confirmed[k]).length;
  const fuDone = Object.values(c.followups).filter(f => f.done).length;
  st.badges = computeBadges(c, st);
  st.xp = (c.report ? XP.report : 0) + confirmedCount * XP.stage + st.checks * XP.check + st.fullDays * XP.fullDay + fuDone * XP.followup + st.badges.filter(b=>b.on).length * XP.badge;
  let lv = 0; LEVELS.forEach((v,i) => { if(st.xp >= v) lv = i; });
  st.level = lv; st.levelName = t('lv')[lv];
  st.nextAt = LEVELS[lv+1] ?? null;
  st.levelPct = st.nextAt ? Math.round((st.xp - LEVELS[lv]) / (st.nextAt - LEVELS[lv]) * 100) : 100;
  return st;
}
function pepAdherence(c, p){
  const td = todayISO(); let due = 0, done = 0; const st = effStart(c,p); const en = effEnd(c,p,'pep') || td;
  for(let d = st; d <= en && d <= td; d = addDays(d,1)) if(scheduledOn(c,p,'pep',d)) (p.slots.length?p.slots:['wake']).forEach(sl => { due++; if(c.checks[`${d}|p:${p.id}|${sl}`]) done++; });
  return due ? done/due : 0;
}
function computeBadges(c, st){
  const fuDone = c.followups[1]?.done;
  const cycle = c.peptides.some(p => pepStatus(c,p) === 'done' && pepAdherence(c,p) >= .8);
  return [
    {id:'baseline', ic:'flag', on:!!c.confirmed.s1},
    {id:'protocol', ic:'target', on:!!(c.confirmed.s2 && c.confirmed.s3)},
    {id:'calendar', ic:'calendar', on:!!c.confirmed.s4},
    {id:'streak7', ic:'pulse', on:st.best >= 7},
    {id:'streak21', ic:'pulse', on:st.best >= 21},
    {id:'adh90', ic:'award', on:(st.adherence ?? 0) >= 90 && (st.elapsed||0) >= 14},
    {id:'cycle', ic:'syringe', on:cycle},
    {id:'fu1', ic:'check', on:!!fuDone}
  ];
}
/* ---------- Stage state ---------- */
function stageState(c, n){
  if(n === 1) return c.confirmed.s1 ? 'done' : (c.report ? 'review' : 'active');
  if(!c.confirmed.s1) return 'locked';
  return c.confirmed['s'+n] ? 'done' : 'active';
}
function defaultStage(c){ for(const n of [1,2,3,4]){ const s = stageState(c,n); if(s === 'active' || s === 'review') return n; } return 4; }

/* ---------- Render ---------- */
function ringSVG(pct, size=104, stroke=9){
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r, off = circ * (1 - pct/100);
  return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="#ECE8DE" stroke-width="${stroke}" fill="none"/><circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="url(#gg)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset .6s"/><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#97713C"/><stop offset="1" stop-color="#F2C87C"/></linearGradient></defs></svg>`;
}

function renderHero(c, st){
  const td = todayISO();
  let dayTxt = t('notStarted');
  if(c.journeyStart && c.confirmed.s1){ const d = diffDays(td, c.journeyStart); dayTxt = d >= 0 ? t('journeyDay', {n:d+1}) : t('startsIn', {n:-d}); }
  const nf = c.confirmed.s1 ? nextFollowup(c) : null;
  let nfTxt = '—', nfSub = '';
  if(nf){ const d = diffDays(nf.date, td); nfTxt = fmtShort(nf.date); nfSub = d > 0 ? t('inDays',{n:d}) : d === 0 ? t('today') : t('overdue',{n:-d}); }
  const badges = st.badges.map(b => `<span class="badge ${b.on?'on':''}" title="${esc(t('b_'+b.id))}">${ic(b.on?b.ic:'lock')}${esc(t('b_'+b.id))}</span>`).join('');
  return `<section class="card">
    <div class="hero">
      <div>
        <span class="mono" style="color:var(--bronze)">${esc(dayTxt)}</span>
        <h1>${esc(c.patient.name || '—')}</h1>
        <div class="hero-meta muted" style="font-size:13px">
          ${c.journeyStart ? `<span>${t('started')}: ${fmtDate(c.journeyStart)}</span>` : ''}
          ${c.report?.date ? `<span>${t('reportDate')}: ${fmtDate(c.report.date)}</span>` : ''}
          ${isAdmin() && c.patient.whatsapp ? `<span>WhatsApp: ${esc(c.patient.whatsapp)}</span>` : ''}
        </div>
      </div>
      <div class="level">
        <div class="ring">${ringSVG(st.levelPct)}<div class="c"><span class="mono muted">${t('level')}</span><b>${st.level+1}</b></div></div>
        <div class="level-txt"><h3>${esc(st.levelName)}</h3><div class="muted" style="font-size:13px">${st.xp} XP</div>
          <div class="xpbar"><i style="width:${st.levelPct}%"></i></div>
          <div class="muted" style="font-size:12px;margin-top:4px">${st.nextAt ? t('xpTo',{x:st.nextAt - st.xp, n:st.level+2}) : t('maxLevel')}</div></div>
      </div>
    </div>
    <div style="padding:0 22px 22px">
      <div class="stats" style="margin-top:0">
        <div class="stat"><span class="mono muted">${t('streak')}</span><div class="v">${st.streak}<small>${st.streak===1?t('day'):t('days')}</small></div></div>
        <div class="stat"><span class="mono muted">${t('adherence')}</span><div class="v">${st.adherence===null?'—':st.adherence+'%'}</div></div>
        <div class="stat"><span class="mono muted">${t('nextFU')}</span><div class="v" style="font-size:18px">${nfTxt}<small>${nfSub}</small></div></div>
        <div class="stat"><span class="mono muted">${t('dosesLogged')}</span><div class="v">${st.checks}<small>${st.fullDays} ${t('fullDays')}</small></div></div>
      </div>
      <div class="badges">${badges}</div>
      <div class="row no-print" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">${linksRow(c)}</div>
    </div>
  </section>`;
}

function renderTrail(c){
  const icons = {1:'file',2:'pill',3:'syringe',4:'calendar'};
  let doneCount = 0;
  const nodes = [1,2,3,4].map(n => {
    const s = stageState(c,n); if(s === 'done') doneCount++;
    const stTxt = {done:t('stDone'), active:t('stActive'), locked:t('stLocked'), review:t('stReview')}[s];
    const icon = s === 'done' ? 'check' : s === 'locked' ? 'lock' : icons[n];
    return `<button class="node ${s==='review'?'active':s} ${ui.stage===n?'sel':''}" data-action="stage" data-n="${n}" ${s==='locked'?'disabled':''}><span class="dot">${ic(icon)}</span><span class="lbl">${t('stage'+n)}</span><span class="st">${stTxt}</span></button>`;
  }).join('');
  let lastDone = 0; for(const n of [1,2,3,4]){ if(stageState(c,n)==='done') lastDone = n; else break; }
  const w = lastDone <= 1 ? 0 : (lastDone - 1) / 3 * 75;
  return `<nav class="trail"><div class="fill" style="width:${w}%"></div>${nodes}</nav>`;
}

function renderStage(c, st){
  const n = ui.stage;
  if(n === 1) return renderStage1(c);
  if(stageState(c,n) === 'locked') return `<div class="alert info">${t('needReview')}</div>`;
  if(n === 2) return renderStage2(c);
  if(n === 3) return renderStage3(c);
  return renderStage4(c);
}

function stageHead(n, extra=''){
  return `<div class="panel-head"><div><span class="mono" style="color:var(--bronze)">0${n} · ${t('stage'+n)}</span><h2>${t('stage'+n+'Long')}</h2></div><div class="row no-print">${extra}</div></div>`;
}

function modeLabel(){ return {server:t('modeServer'), local:t('modeLocal')}[APP.settings.extractMode] || t('modeServer'); }

function renderStage1(c){
  if(!isAdmin()) return renderStage1Client(c);
  const hasReport = !!c.report;
  let html = stageHead(1, hasReport ? `${(c.report.storagePaths||[]).length ? `<button class="btn sm" data-action="report-file">${ic('file')}${t('cl_report')}</button>` : ''}<button class="btn sm" data-action="editor">${ic('edit')}${t('reviewData')}</button>` : '');
  if(ui.busy){
    html += `<div class="progress-card"><div class="spin"></div><div><b>${t('extraction')}</b><div class="muted" id="progressText" style="font-size:13px">${esc(ui.progress)}</div></div></div>`;
  } else {
    html += `<div class="drop no-print" id="drop">${ic('upload')}<p><b>${hasReport ? t('replace') : t('uploadTitle')}</b></p><p class="muted" style="font-size:14px">${t('uploadText')} <a href="#" data-action="pick" data-mode="replace">${t('choose')}</a>.</p><p class="mono muted">${t('uploadTypes')}</p>
      ${hasReport ? `<div class="row" style="justify-content:center;margin-top:10px"><button class="btn sm" data-action="pick" data-mode="append">${ic('plus')}${t('addDoc')}</button></div>` : ''}</div>
      <div class="note no-print">${t('extraction')}: <b>${modeLabel()}</b> · <a href="#" data-action="settings">${t('settings')}</a><br>${t('privacy')}${hasReport ? '<br>' + t('addDocHint') : ''}</div>`;
  }
  if(ui.error){
    const btns = ui.errorKind === 'nofn' || ui.errorKind === 'generic' ? `<div class="row" style="margin-top:10px"><button class="btn sm" data-action="retry-local">${t('tryLocal')}</button><button class="btn sm" data-action="settings">${t('openSettings')}</button></div>` : (ui.errorKind === 'auth' || ui.errorKind === 'key') ? `<div class="row" style="margin-top:10px"><button class="btn sm" data-action="settings">${t('openSettings')}</button></div>` : '';
    html += `<div class="alert err">${esc(ui.error)}${btns}</div>`;
  }
  if(!hasReport) return html;
  if(!c.confirmed.s1) html += `<div class="alert warn" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><span>${t('needReview')}</span><button class="btn primary sm" data-action="editor">${t('reviewData')}</button></div>`;
  const r = c.report;
  html += `<div class="section"><h3>${t('reportData')}</h3><div class="meta">
    <div><span class="mono muted">${t('patient')}</span><b>${esc(c.patient.name||'—')}</b></div>
    <div><span class="mono muted">${t('reportDate')}</span><b>${fmtDate(r.date)}</b></div>
    <div><span class="mono muted">${t('lab')}</span><b>${esc(r.lab||'—')}</b></div>
    <div><span class="mono muted">${t('practitioner')}</span><b>${esc(r.practitioner||'—')}</b></div>
    <div><span class="mono muted">${t('journeyStart')}</span><b>${fmtDate(c.journeyStart)}</b></div>
    <div><span class="mono muted">${t('files')}</span><b style="font-size:13px">${(r.files||[]).map(esc).join('<br>')||'—'}</b></div>
  </div>${r.summary ? `<p style="margin:14px 0 0;white-space:pre-line">${esc(r.summary)}</p>` : ''}</div>`;
  const counts = {low:0, normal:0, high:0};
  c.biomarkers.forEach(b => { if(counts[b.status] !== undefined) counts[b.status]++; });
  html += `<div class="section"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h3>${t('biomarkers')} <span class="muted" style="font-weight:400">(${c.biomarkers.length})</span></h3><div class="row" style="gap:6px"><span class="chip low">${t('s_low')} ${counts.low}</span><span class="chip normal">${t('s_normal')} ${counts.normal}</span><span class="chip high">${t('s_high')} ${counts.high}</span></div></div>`;
  html += c.biomarkers.length ? `<div class="tbl-wrap"><table><thead><tr><th>${t('marker')}</th><th>${t('value')}</th><th>${t('ref')}</th><th>${t('status')}</th></tr></thead><tbody>${c.biomarkers.map(b => `<tr><td>${esc(b.name)}</td><td><b>${esc(b.value)}</b> <span class="muted">${esc(b.unit)}</span></td><td class="muted">${esc(b.ref||'—')}</td><td><span class="chip ${b.status}">${t('s_'+b.status)}</span></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${t('noBiomarkers')}</p>`;
  html += `</div>`;
  return html;
}

const slotChips = slots => slots.map(s => `<span class="chip slot">${t('slot_'+s)}</span>`).join(' ');
function weekDots(it){
  if(it.everyN > 1) return `<div class="muted" style="font-size:13px;margin-top:10px">${t('everyN',{n:it.everyN})}</div>`;
  const days = it.days && it.days.length ? it.days : ALL_DAYS;
  return `<div class="week">${WEEK_ORDER.map(d => `<span class="${days.includes(d)?'on':''}" title="${t('dowLong')[d]}">${t('dowLong')[d]}</span>`).join('')}</div>`;
}
function confirmBtn(c, n, label){
  if(isAdmin()) return c.confirmed['s'+n] ? `<span class="chip done">${ic('check')} ${t('clientConfirmed')}</span>` : `<span class="chip unknown">${t('waitingClient')}</span>`;
  return c.confirmed['s'+n] ? `<span class="chip done">${ic('check')} ${t('confirmed')}</span>` : `<button class="btn gold sm" data-action="confirm" data-n="${n}" ${canWrite()?'':'disabled'}>${ic('check')}${label || t('readProtocol')} · +${XP.stage} XP</button>`;
}
const editBtn = () => isAdmin() ? `<button class="btn sm" data-action="editor">${ic('edit')}${t('editData')}</button>` : '';

function renderStage2(c){
  let html = stageHead(2, `${shopBtn()}${editBtn()}${confirmBtn(c,2)}`);
  if(!c.supplements.length) return html + `<p class="muted">${t('noSupp')}</p>`;
  html += `<div class="items">${c.supplements.map(s => {
    const en = effEnd(c,s,'supp');
    return `<div class="item"><h3>${ic('pill')}${esc(s.name)}</h3><div class="dose">${esc(s.dose||'—')}</div>
      <div style="margin-top:8px">${slotChips(s.slots)}</div>${weekDots(s)}
      <div class="kv">${s.form?`<span>${t('form')}</span><span>${esc(s.form)}</span>`:''}${s.frequency?`<span>${t('frequency')}</span><span>${esc(s.frequency)}</span>`:''}
      <span>${t('startD')}</span><span>${fmtDate(effStart(c,s))}</span><span>${t('duration')}</span><span>${en ? `${s.durationDays} ${t('days')} · ${fmtShort(en)}` : t('ongoing')}</span></div>
      ${s.instructions?`<p><span class="muted">${t('instructions')}:</span> ${esc(s.instructions)}</p>`:''}${s.rationale?`<p><span class="muted">${t('rationale')}:</span> ${esc(s.rationale)}</p>`:''}</div>`;
  }).join('')}</div>`;
  html += `<div class="section"><h3>${t('schedule')}</h3>${slotSchedule(c.supplements)}</div>`;
  return html;
}

function slotSchedule(items, kind){
  const bySlot = {}; items.forEach(s => (s.slots.length ? s.slots : [kind === 'pep' ? 'wake' : 'breakfast']).forEach(sl => (bySlot[sl] = bySlot[sl] || []).push(s)));
  const when = s => s.everyN > 1 ? t('everyN', { n:s.everyN }) : (s.days.length && s.days.length < 7) ? s.days.slice().sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)).map(d => t('dowLong')[d]).join(', ') : '';
  return `<div class="sched">${SLOTS.filter(sl => bySlot[sl]).map(sl => `<div class="slotrow"><div class="t"><span class="mono muted">${SLOT_TIME[sl]}</span><b>${t('slot_' + sl)}</b></div><ul>${bySlot[sl].map(s => `<li><span>${esc(s.name)}${when(s) ? ` <span class="muted" style="font-size:12px">· ${when(s)}</span>` : ''}${kind === 'pep' ? ` <span class="muted" style="font-size:12px">· ${t('r_' + s.route)}</span>` : ''}</span><em>${esc(s.dose)}</em></li>`).join('')}</ul></div>`).join('')}</div>`;
}

function renderStage3(c){
  let html = stageHead(3, `${editBtn()}${confirmBtn(c,3)}`);
  if(!c.peptides.length) return html + `<p class="muted">${t('noPep')}</p>`;
  const td = todayISO();
  html += renderPepAlert(c);
  if(c.peptides.some(p => !effEnd(c,p,'pep'))) html += `<div class="alert warn" style="margin-top:0;margin-bottom:14px">${t('tbdWarn')}</div>`;
  html += `<div class="items">${c.peptides.map(p => {
    const st = effStart(c,p), en = effEnd(c,p,'pep'), status = pepStatus(c,p);
    const total = en ? diffDays(en, st) + 1 : null;
    const cur = Math.min(Math.max(diffDays(td, st) + 1, 0), total || 0);
    const chipCls = {active:'active', sched:'sched', done:'done', tbd:'tbd'}[status];
    return `<div class="item"><div class="row" style="justify-content:space-between"><h3>${ic('syringe')}${esc(p.name)}</h3><span class="chip ${chipCls}">${t('p_'+status)}</span></div>
      <div class="dose">${esc(p.dose||'—')}</div><div style="margin-top:8px">${slotChips(p.slots)}</div>${weekDots(p)}
      <div class="kv"><span>${t('route')}</span><span>${t('r_'+p.route)}</span>${p.frequency?`<span>${t('frequency')}</span><span>${esc(p.frequency)}</span>`:''}
      <span>${t('startD')}</span><span><b>${fmtDate(st)}</b></span><span>${t('endD')}</span><span><b>${en?fmtDate(en):'—'}</b></span>${total?`<span>${t('cycleLen')}</span><span>${total} ${t('days')}</span>`:''}</div>
      ${total ? `<div class="cycle"><div class="row" style="justify-content:space-between;font-size:12px"><span class="muted">${status==='sched'?t('startsIn',{n:diffDays(st,td)}):t('dayOf',{a:cur,b:total})}</span><span class="mono muted">${Math.round(cur/total*100)}%</span></div><div class="bar"><i style="width:${cur/total*100}%"></i></div></div>` : ''}
      ${p.reconstitution?`<p><span class="muted">${t('reconstitution')}:</span> ${esc(p.reconstitution)}</p>`:''}${p.instructions?`<p><span class="muted">${t('instructions')}:</span> ${esc(p.instructions)}</p>`:''}${p.rationale?`<p><span class="muted">${t('rationale')}:</span> ${esc(p.rationale)}</p>`:''}</div>`;
  }).join('')}</div>`;
  const activePeps = c.peptides.filter(p => pepStatus(c, p) !== 'done');
  html += `<div class="section"><h3>${t('pepSchedule')}</h3>${slotSchedule(activePeps.length ? activePeps : c.peptides, 'pep')}</div>`;
  html += `<div class="section"><h3>${t('cycles')}</h3>${renderGantt(c)}</div>`;
  return html;
}

function renderPepAlert(c){
  const pa = c.pepAlert || { on:false, hour:8 };
  const can = canWrite();
  const hours = []; for(let h = 5; h <= 22; h++) hours.push(h);
  const sel = `<select data-action="pep-hour" ${can ? '' : 'disabled'}>${hours.map(h => `<option value="${h}" ${(pa.hour ?? 8) === h ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select>`;
  const on = !!pa.on && pa.channel === 'push';
  const sub = isAdmin()
    ? (on ? t('pepAlertOn', { h:pad(pa.hour ?? 8) + ':00' }) + ` · ${t('pushDevices', { n:pa.devices || 1 })}` + (c.tz || pa.tz ? ` · ${esc(c.tz || pa.tz)}` : '') : t('pepAlertOff'))
    : (on ? t('pushOnDesc', { h:pad(pa.hour ?? 8) + ':00' }) : t('pushDesc'));
  return `<div class="alert-card ${on ? 'on' : ''}">
    <div class="ac-ic">${ic('bell')}</div>
    <div class="ac-txt"><b>${t('pushTitle')}</b><span class="muted">${sub}</span></div>
    <div class="ac-ctl"><label class="pa-hour">${t('pepAlertTime')} ${sel}</label>
      <button class="switch ${on ? 'on' : ''}" data-action="pep-toggle" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${t('pushTitle')}" ${can ? '' : 'disabled'}><i></i></button></div>
    ${isAdmin() ? '' : `<div class="ac-foot"><button class="linkbtn" data-action="pep-ics" ${APP.mode === 'preview' ? 'disabled' : ''}>${ic('calendar')}${t('pepIcs')}</button></div>`}
  </div>`;
}

/* Recurring calendar reminders for peptides (works on any phone, no installation) */
function buildPeptideICS(c){
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const BY = ['SU','MO','TU','WE','TH','FR','SA'];
  const ev = [];
  c.peptides.forEach(p => {
    const st = effStart(c, p), en = effEnd(c, p, 'pep');
    if(en && en < todayISO()) return;
    let first = st > todayISO() ? st : todayISO();
    for(let i = 0; i < 60 && !scheduledOn(c, p, 'pep', first); i++) first = addDays(first, 1);
    if(!scheduledOn(c, p, 'pep', first)) return;
    let rule;
    if(p.everyN > 1){ const off = ((diffDays(first, st) % p.everyN) + p.everyN) % p.everyN; if(off) first = addDays(first, p.everyN - off); rule = `FREQ=DAILY;INTERVAL=${p.everyN}`; }
    else if(p.days && p.days.length && p.days.length < 7) rule = `FREQ=WEEKLY;BYDAY=${p.days.map(d => BY[d]).join(',')}`;
    else rule = 'FREQ=DAILY';
    if(en) rule += `;UNTIL=${en.replace(/-/g, '')}T235959`;
    (p.slots.length ? p.slots : ['wake']).forEach(sl => {
      const [hh, mm] = SLOT_TIME[sl].split(':'); const d = first.replace(/-/g, '');
      const end = (+hh) * 60 + (+mm) + 15;
      const title = `${p.name} · ${p.dose || ''}`.trim();
      ev.push(['BEGIN:VEVENT', `UID:${c.id}-${p.id}-${sl}@regenecure-journey`, `DTSTAMP:${now}`, `DTSTART:${d}T${hh}${mm}00`, `DTEND:${d}T${pad(Math.floor(end / 60) % 24)}${pad(end % 60)}00`, `RRULE:${rule}`,
        `SUMMARY:${icsEscape('RegeneCure · ' + title)}`, `DESCRIPTION:${icsEscape(`${t('r_' + p.route)} · ${t('slot_' + sl)}${p.instructions ? '\n' + p.instructions : ''}`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${icsEscape(title)}`, 'END:VALARM', 'END:VEVENT'].join('\r\n'));
    });
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RegeneCure//Client Journey//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:RegeneCure · ${t('peptides')}`, ...ev, 'END:VCALENDAR'].join('\r\n');
}

function attendanceChip(c, n){
  const s = c.fuConfirm?.[n]?.status;
  if(s === 'confirmed') return `<span class="chip normal">${t('attConfirmed')}</span>`;
  if(s === 'reschedule') return `<span class="chip high">${t('attReschedule')}</span>`;
  return '';
}
function renderAttendance(c, nf){
  const s = c.fuConfirm?.[nf.n]?.status;
  if(isAdmin()) return `<div style="margin-top:10px">${s ? attendanceChip(c, nf.n) : `<span class="chip" style="background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25);color:#fff">${t('attWaiting')}</span>`}</div>`;
  const dis = canWrite() ? '' : 'disabled';
  return `<div class="att" id="attendance"><div style="font-size:13px;margin-top:12px">${s === 'confirmed' ? t('attDoneConfirmed') : s === 'reschedule' ? t('attDoneReschedule') : t('attAsk')}</div>
    <div class="row" style="margin-top:8px"><button class="btn sm ${s === 'confirmed' ? 'gold' : ''}" data-action="att" data-n="${nf.n}" data-v="confirmed" ${dis}>${ic('check')}${t('attConfirmBtn')}</button><button class="btn sm ${s === 'reschedule' ? 'gold' : ''}" data-action="att" data-n="${nf.n}" data-v="reschedule" ${dis}>${ic('calendar')}${t('attRescheduleBtn')}</button></div></div>`;
}

function renderGantt(c){
  const js = c.journeyStart; let last = addDays(js, 89);
  c.peptides.forEach(p => { const e = effEnd(c,p,'pep') || addDays(effStart(c,p), 29); if(e > last) last = e; });
  const total = diffDays(last, js) + 1; const td = todayISO();
  const pct = d => (diffDays(d, js) / total * 100);
  const weeks = Math.ceil(total / 7); const step = weeks > 20 ? 4 : weeks > 10 ? 2 : 1;
  let axis = ''; for(let w = 0; w < weeks; w += step) axis += `<span style="left:${(w*7+3.5)/total*100}%">${t('week')}${w+1}</span>`;
  const fus = followupDates(c).filter(f => f.date <= last).map(f => `<i class="g-fu" style="left:${(pct(f.date)+0.5/total*100)}%" title="${t('fuN',{n:f.n})} · ${fmtDate(f.date)}"></i>`).join('');
  const rows = c.peptides.map(p => {
    const st = effStart(c,p), en = effEnd(c,p,'pep'); const shownEnd = en || addDays(st, 29);
    const left = Math.max(0, pct(st)), width = Math.max(1.5, (diffDays(shownEnd, st) + 1) / total * 100);
    const cls = !en ? 'tbd' : td > en ? 'past' : td < st ? 'future' : '';
    return `<div class="g-row"><div class="n" title="${esc(p.name)}">${esc(p.name)}</div><div class="g-track"><div class="g-bar ${cls}" style="left:${left}%;width:${width}%" title="${fmtDate(st)} → ${en?fmtDate(en):'?'}">${fmtShort(st)} → ${en?fmtShort(en):'?'}</div></div></div>`;
  }).join('');
  const todayLine = td >= js && td <= last ? `<div class="g-today" style="left:calc(150px + (100% - 150px) * ${(pct(td)+0.5/total*100)/100})" data-l="${t('todayL')}"></div>` : '';
  return `<div class="gantt"><div class="g-inner">${todayLine}<div class="g-axis">${axis}${fus}</div>${rows}</div></div>
    <div class="legend"><span><i style="background:var(--navy)"></i>${t('legendActive')}</span><span><i style="background:#8E95D6"></i>${t('legendFuture')}</span><span><i style="background:var(--bronze)"></i>${t('legendPast')}</span><span><i style="background:var(--gold);transform:rotate(45deg);border:1px solid var(--bronze)"></i>${t('fuMarker')}</span><span><i style="background:var(--high);width:3px"></i>${t('todayL')}</span></div>`;
}

function renderStage4(c){
  const list = followupDates(c); const nf = nextFollowup(c); const td = todayISO();
  let html = stageHead(4, `<button class="btn sm" data-action="ics-all">${ic('download')}${t('allIcs')}</button>${confirmBtn(c, 4, t('confirmAgenda'))}`);
  html += `<p class="muted" style="margin-top:-6px">${t('fuEvery')}</p>`;
  if(nf){
    const d = diffDays(nf.date, td);
    html += `<div class="fu-next"><div class="fu-count"><b>${Math.abs(d)}</b><span class="mono">${d===0?t('today'):t('days')}</span></div>
      <div><span class="mono">${t('nextFU')} · ${t('fuN',{n:nf.n})}</span><h2>${fmtDate(nf.date, {weekday:'long', day:'2-digit', month:'long', year:'numeric'})}</h2>
      <div style="opacity:.8;font-size:13px">${d>0?t('inDays',{n:d}):d===0?t('today'):t('overdue',{n:-d})}</div>
      ${renderAttendance(c, nf)}
      <div class="row" style="margin-top:12px">${isAdmin() ? `<label style="font-size:13px">${t('fuTime')} <input type="time" value="${esc(c.followUpTime)}" data-action="fu-time"></label>` : `<span style="font-size:13px">${t('fuTime')}: <b>${esc(c.followUpTime)}</b></span>`}
      <button class="btn sm gold" data-action="ics" data-n="${nf.n}">${ic('download')}${t('addCal')}</button>
      <a class="btn sm" href="${gcalLink(c, nf)}" target="_blank" rel="noopener" data-action="gcal">${ic('link')}${t('gcal')}</a>
      ${isAdmin() && c.status === 'published' ? `<button class="btn sm" data-action="send-fu" data-n="${nf.n}">${ic('send')}${(c.remindersSent||[]).includes(nf.n) ? t('reminderSent') + ' · ' + t('resend') : t('sendReminder')}</button>` : ''}
      ${isAdmin() && nf.date <= td ? `<button class="btn sm" data-action="fu-done" data-n="${nf.n}">${ic('check')}${t('markDone')} · +${XP.followup} XP</button>` : ''}</div></div></div>`;
  }
  html += `<div class="section"><h3>${t('followups')}</h3><div class="fu-list">${list.map(f => {
    const done = c.followups[f.n]?.done; const d = diffDays(f.date, td);
    return `<div class="fu-item ${done?'done':''}"><div class="num">${done?ic('check'):f.n}</div><div><b>${t('fuN',{n:f.n})}</b> · ${fmtDate(f.date, {weekday:'short', day:'2-digit', month:'short', year:'numeric'})}<div class="muted" style="font-size:12px">${done?t('done'):(d>0?t('inDays',{n:d}):d===0?t('today'):t('overdue',{n:-d}))} · ${t('day')} ${30*f.n}</div></div>
      <div class="row" style="gap:6px">${attendanceChip(c, f.n)}${isAdmin() && (c.remindersSent||[]).includes(f.n) ? `<span class="chip sched">${t('reminderSent')}</span>` : ''}${done ? (isAdmin() ? `<button class="btn sm ghost" data-action="fu-undo" data-n="${f.n}">${t('undo')}</button>` : '') : `<button class="btn sm" data-action="ics" data-n="${f.n}" title="${t('addCal')}">${ic('download')}.ics</button>${isAdmin() && f.date <= td ? `<button class="btn sm" data-action="fu-done" data-n="${f.n}" title="${t('markDone')}">${ic('check')}</button>` : ''}`}</div></div>`;
  }).join('')}</div></div>`;
  if(c.followUpNotes) html += `<div class="section"><h3>${t('fuNotes')}</h3><p style="white-space:pre-line;margin:0">${esc(c.followUpNotes)}</p></div>`;
  return html;
}

function renderToday(c){
  const d = ui.day, td = todayISO();
  const head = `<div class="today-head"><div><span class="mono muted">${t('todayPanel')}</span><h3>${d===td?t('todayL')+' · ':''}${fmtDate(d, {weekday:'short', day:'2-digit', month:'short'})}</h3></div>
    <div class="nav"><button class="icon-btn" data-action="day" data-d="-1" aria-label="prev">${ic('left')}</button><button class="icon-btn" data-action="day" data-d="0" aria-label="today">${ic('target')}</button><button class="icon-btn" data-action="day" data-d="1" aria-label="next">${ic('right')}</button></div></div>`;
  if(!c.confirmed.s1) return head + `<p class="muted" style="font-size:14px">${t('lockedToday')}</p>`;
  const items = dueItems(c, d);
  if(!items.length) return head + `<p class="muted" style="font-size:14px;margin-top:14px">${t('noDoses')}</p>`;
  const done = items.filter(x => c.checks[x.key]).length; const future = d > td; const locked = future || !canWrite();
  let html = head + `<div class="dayprog"><div class="row" style="justify-content:space-between;font-size:13px"><span>${done} ${t('of')} ${items.length}</span><span class="mono muted">${Math.round(done/items.length*100)}%</span></div><div class="xpbar"><i style="width:${done/items.length*100}%"></i></div></div>`;
  if(future) html += `<p class="muted" style="font-size:12px">${t('futureDay')}</p>`;
  if(isAdmin()) html += `<p class="muted" style="font-size:12px">${t('adminTodayNote')}</p>`;
  const groups = {}; items.forEach(x => (groups[x.slot] = groups[x.slot] || []).push(x));
  SLOTS.filter(s => groups[s]).forEach(s => {
    html += `<div class="tgroup"><span class="mono">${SLOT_TIME[s]} · ${t('slot_'+s)}</span>${groups[s].map(x => {
      const on = !!c.checks[x.key];
      return `<button class="check ${on?'on':''}" data-action="check" data-key="${esc(x.key)}" ${locked?'disabled':''}><span class="box">${ic('check')}</span><span><span class="nm">${esc(x.item.name)}</span><br><span class="ds">${esc(x.item.dose)}${x.kind==='pep'?' · '+t('r_'+x.item.route):''}</span></span><span class="tag">${x.kind==='pep'?t('pep'):t('supp')}</span></button>`;
    }).join('')}</div>`;
  });
  return html;
}

function linksRow(c){
  let html = shopBtn();
  if(isAdmin()) html += `<button class="btn sm" data-action="fitline">${ic('send')}${t('fitline')}</button>`;
  else if(c.fitline?.enabled && fitlineUrl()) html += `<a class="btn sm" href="${esc(APP.fitlineHref || fitlineUrl())}" target="_blank" rel="noopener">${ic('link')}${t('fitline')}</a>`;
  return html;
}
function shopBtn(){ return `<a class="btn sm primary" href="${esc(shopUrl())}" target="_blank" rel="noopener">${ic('bag')}${t('shop')}</a>`; }

function renderStage1Client(c){
  const r = c.report || {};
  const hasFile = (r.storagePaths || []).length > 0;
  let html = stageHead(1, hasFile ? `<button class="btn sm" data-action="report-file" ${APP.mode==='preview'?'disabled':''}>${ic('download')}${t('cl_report')}</button>` : '');
  html += `<div class="meta">
    <div><span class="mono muted">${t('reportDate')}</span><b>${fmtDate(r.date)}</b></div>
    <div><span class="mono muted">${t('lab')}</span><b>${esc(r.lab||'—')}</b></div>
    <div><span class="mono muted">${t('practitioner')}</span><b>${esc(r.practitioner||'—')}</b></div>
    <div><span class="mono muted">${t('journeyStart')}</span><b>${fmtDate(c.journeyStart)}</b></div>
  </div>${r.summary ? `<p style="margin:14px 0 0;white-space:pre-line">${esc(r.summary)}</p>` : ''}`;
  const counts = {low:0, normal:0, high:0};
  c.biomarkers.forEach(b => { if(counts[b.status] !== undefined) counts[b.status]++; });
  html += `<div class="section"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h3>${t('biomarkers')} <span class="muted" style="font-weight:400">(${c.biomarkers.length})</span></h3><div class="row" style="gap:6px"><span class="chip low">${t('s_low')} ${counts.low}</span><span class="chip normal">${t('s_normal')} ${counts.normal}</span><span class="chip high">${t('s_high')} ${counts.high}</span></div></div>`;
  html += c.biomarkers.length ? `<div class="tbl-wrap"><table><thead><tr><th>${t('marker')}</th><th>${t('value')}</th><th>${t('ref')}</th><th>${t('status')}</th></tr></thead><tbody>${c.biomarkers.map(b => `<tr><td>${esc(b.name)}</td><td><b>${esc(b.value)}</b> <span class="muted">${esc(b.unit)}</span></td><td class="muted">${esc(b.ref||'—')}</td><td><span class="chip ${b.status}">${t('s_'+b.status)}</span></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${t('noBiomarkers')}</p>`;
  return html + `</div>`;
}

function renderJourney(c){
  if(ui.stage === null) ui.stage = defaultStage(c);
  if(stageState(c, ui.stage) === 'locked') ui.stage = 1;
  const st = computeStats(c);
  return renderHero(c, st) + renderTrail(c) +
    `<div class="grid"><section class="card pad" id="stagePanel">${renderStage(c, st)}</section><aside class="card pad today">${renderToday(c)}</aside></div>`;
}

/* ---------- Mapping between database rows and the in-memory client ---------- */
function rowToClient(row, checks){
  const d = row.data || {}, p = row.progress || {};
  return {
    id:row.id, status:row.status || 'draft', lang:row.lang || 'pt', accessToken:row.access_token || '',
    patient:{ dob:'', sex:'', patientId:'', ...(d.patient || {}), name:row.name || '', whatsapp:row.whatsapp || '' },
    report:d.report || null, journeyStart:d.journeyStart || row.journey_start || '',
    biomarkers:d.biomarkers || [], supplements:d.supplements || [], peptides:d.peptides || [], followUpNotes:d.followUpNotes || '',
    confirmed:{ s1:!!d.s1Confirmed, s2:!!p.confirmed?.s2, s3:!!p.confirmed?.s3, s4:!!p.confirmed?.s4 },
    checks:Object.fromEntries((checks || []).map(k => [k, true])),
    followups:d.followups || {}, followUpTime:d.followUpTime || '10:00', fitline:d.fitline || {},
    seenBadges:p.seenBadges || [], lastLevel:p.lastLevel || 0, remindersSent:row.reminders_sent || [],
    fuConfirm:p.fuConfirm || {}, pepAlert:{ on:false, hour:8, ...(p.pepAlert || {}) }, tz:row.tz || '',
    publishedAt:row.published_at || null, lastSentAt:row.last_sent_at || null, lastSeenAt:row.last_seen_at || null, createdAt:row.created_at || null
  };
}
function clientToRow(c){
  const { name, whatsapp, ...pat } = c.patient;
  return {
    name:(name || '').trim() || '—', whatsapp:(whatsapp || '').trim() || null, lang:c.lang === 'en' ? 'en' : 'pt',
    data:{ patient:pat, report:c.report, journeyStart:c.journeyStart, biomarkers:c.biomarkers, supplements:c.supplements, peptides:c.peptides,
      followUpNotes:c.followUpNotes, s1Confirmed:!!c.confirmed.s1, followups:c.followups, followUpTime:c.followUpTime, fitline:c.fitline || {} },
    journey_start:c.journeyStart || null,
    followup_dates:c.journeyStart && c.confirmed.s1 ? followupDates(c).map(f => f.date) : []
  };
}

/* ---------- Calendar ---------- */
function icsEscape(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function fuEventParts(c, f){
  const [hh, mm] = (c.followUpTime || '10:00').split(':');
  const d = f.date.replace(/-/g,'');
  const endMin = (+hh)*60 + (+mm) + 45; const eh = pad(Math.floor(endMin/60)%24), em = pad(endMin%60);
  const title = `RegeneCure · ${t('fuN',{n:f.n})} · ${c.patient.name||''}`.trim();
  const active = c.peptides.filter(p => scheduledOn(c,p,'pep',f.date) || (effStart(c,p) <= f.date && (effEnd(c,p,'pep')||'9999') >= f.date)).map(p => p.name);
  const desc = `${t('fuN',{n:f.n})} — ${t('day')} ${30*f.n}.\n${active.length ? t('peptides') + ': ' + active.join(', ') + '\n' : ''}${c.followUpNotes||''}`;
  return { start:`${d}T${pad(+hh)}${pad(+mm)}00`, end:`${d}T${eh}${em}00`, title, desc };
}
function buildICS(c, list){
  const now = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  const ev = list.map(f => { const e = fuEventParts(c, f); return ['BEGIN:VEVENT', `UID:${c.id}-fu${f.n}@regenecure-journey`, `DTSTAMP:${now}`, `DTSTART:${e.start}`, `DTEND:${e.end}`, `SUMMARY:${icsEscape(e.title)}`, `DESCRIPTION:${icsEscape(e.desc)}`, 'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-P1D',`DESCRIPTION:${icsEscape(e.title)}`,'END:VALARM','END:VEVENT'].join('\r\n'); });
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//RegeneCure//Client Journey//EN','CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
}
function gcalLink(c, f){ const e = fuEventParts(c, f); return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${e.start}/${e.end}&details=${encodeURIComponent(e.desc)}`; }
function download(name, content, type){ const blob = new Blob([content], {type}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const slug = s => (s||'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();

/* ---------- Modals ---------- */
function openModal(html, wide){ $('#modalRoot').innerHTML = `<div class="overlay" data-action="overlay"><div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true">${html}</div></div>`; document.body.style.overflow = 'hidden'; }
function closeModal(){ $('#modalRoot').innerHTML = ''; document.body.style.overflow = ''; editorDraft = null; }
const modalOpen = () => !!$('#modalRoot').innerHTML;
const modalHead = title => `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-action="close">${ic('x')}</button></div>`;
function showLevelUp(st){
  openModal(`<div class="levelup"><span class="mono" style="color:var(--bronze)">${t('levelUp')}</span><div class="ring">${ringSVG(100)}<div class="c"><span class="mono muted">${t('level')}</span><b>${st.level+1}</b></div></div><h2>${esc(st.levelName)}</h2><p class="muted">${t('levelUpText',{n:st.level+1, name:st.levelName})}</p><button class="btn primary" data-action="close">${t('continue')}</button></div>`);
}
/* ---------- Feedback ---------- */
function toast(msg, kind='', icon='check'){ const el = document.createElement('div'); el.className = 'toast ' + kind; el.innerHTML = ic(icon) + `<span>${esc(msg)}</span>`; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3800); }
function xpFloat(n, target){ const r = target?.getBoundingClientRect?.() || {left:innerWidth/2, top:innerHeight/2, width:0}; const el = document.createElement('div'); el.className = 'xpfloat'; el.textContent = `+${n} XP`; el.style.left = (r.left + r.width - 40) + 'px'; el.style.top = (r.top) + 'px'; document.body.appendChild(el); setTimeout(() => el.remove(), 1100); }
