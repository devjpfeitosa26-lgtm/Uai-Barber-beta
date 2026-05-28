# Guia rápido: Typebot -> Supabase

## 1) Endpoint HTTP para inserir diretamente na tabela
Use o endpoint REST do Supabase:

```text
POST https://SEU-PROJETO.supabase.co/rest/v1/agendamentos
```

## 2) Headers necessários
No bloco de requisição HTTP do Typebot, envie estes headers:

```http
Content-Type: application/json
apikey: SUA_SERVICE_ROLE_KEY
Authorization: Bearer SUA_SERVICE_ROLE_KEY
Prefer: return=representation
```

> **Importante:** para o Typebot inserir em nome de qualquer barbeiro (`prof_id` variável), o caminho mais simples é usar a **Service Role Key** em um ambiente seguro do Typebot. Nunca exponha essa chave no front-end do site. Em produção, o mais seguro é colocar essa lógica em uma **Supabase Edge Function** e deixar o Typebot chamar a função, não a tabela diretamente.

## 3) JSON esperado pelo Supabase
O Typebot precisa enviar um corpo JSON com os campos abaixo:

```json
{
  "prof_id": "UUID_DO_BARBEIRO",
  "servico_id": "UUID_DO_SERVICO",
  "nome_cliente": "João Silva",
  "whatsapp_cliente": "5511999999999",
  "horario_inicio": "2026-05-28T14:00:00-03:00",
  "status": "confirmado"
}
```

## 4) Como o Typebot descobre `prof_id` e `servico_id`
Você precisa mapear isso antes do POST final:

- `prof_id`: UUID fixo do barbeiro que receberá o agendamento.
- `servico_id`: UUID do serviço escolhido pelo cliente.
- `horario_inicio`: data/hora final validada pela IA e pelo fluxo do bot.

## 5) Exemplo de resposta esperada
Se tudo der certo e o header `Prefer: return=representation` estiver ativo, o Supabase retorna o registro recém-criado. Esse insert vai disparar o **Realtime** e atualizar o `dashboard.html` automaticamente.

## 6) Fluxo recomendado em produção
Mesmo sendo possível inserir direto na tabela, a arquitetura mais segura é:

```text
Typebot -> Edge Function (valida disponibilidade, barbeiro e serviço) -> Supabase
```

Assim você evita:

- gravação com `prof_id` incorreto;
- `servico_id` inválido;
- horário duplicado;
- exposição indevida de permissões amplas.


## 7) Bloqueios de agenda (férias, almoço, folga)
Com a nova tabela `bloqueios_agenda`, o painel e o banco passam a impedir agendamentos em períodos indisponíveis.

Estrutura principal do bloqueio:

```json
{
  "prof_id": "UUID_DO_BARBEIRO",
  "titulo": "Horário de almoço",
  "tipo": "almoco",
  "inicio": "2026-05-28T12:00:00-03:00",
  "fim": "2026-05-28T13:00:00-03:00",
  "observacao": "Retorno às 13h"
}
```

Tipos sugeridos: `almoco`, `ferias`, `folga`, `pausa` e `personalizado`.

## 8) O que muda no fluxo do bot
Mesmo que o Typebot tente inserir um horário dentro de um bloqueio, o banco agora rejeita a operação automaticamente por trigger. Ainda assim, o ideal continua sendo validar antes no fluxo para não oferecer horários indisponíveis.

Fluxo recomendado:

```text
Typebot -> consulta disponibilidade -> ignora bloqueios_agenda -> tenta reservar -> banco valida novamente
```

## 9) Edge Function / backend recomendado
Se você usar Edge Function, faça a checagem de sobreposição antes do insert final:

- o horário escolhido não pode cruzar com `bloqueios_agenda`;
- o horário escolhido não pode cruzar com outro `agendamento` ativo;
- o banco continuará como camada final de proteção.
