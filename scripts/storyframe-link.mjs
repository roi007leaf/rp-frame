/** Use StoryFrame's public state-manager methods; never rewrite its scene flags. */
export class StoryframeLink {
  constructor(host) { this.host = host; this.tail = Promise.resolve(); }

  sync(scene) {
    this.tail = this.tail.then(() => this.apply(scene)).catch(error => this.host.error(error));
    return this.tail;
  }

  async apply(scene) {
    if (!this.host.isAuthority()) return;
    const manager = this.host.manager();
    const story = manager?.getState();
    if (!story) return;
    let link = this.host.load() ?? {};
    const sceneId = this.host.sceneId();
    if (link.sceneId !== sceneId) link = {};
    const user = scene.speaker ? this.host.user(scene.speaker) : null;
    const match = this.host.enabled() && scene.active && user ? story.speakers?.find(speaker => !speaker.isHidden && (
      (user.character?.uuid && speaker.actorUuid === user.character.uuid) || speaker.userId === user.id
    )) : null;
    if (match) {
      if (link.managed !== match.id) {
        const previous = link.managed && story.activeSpeaker === link.managed ? link.previous : story.activeSpeaker;
        await this.host.save({ sceneId, previous: previous ?? null, managed: match.id });
        await manager.setActiveSpeaker(match.id);
        this.host.render();
      }
    } else if (link.managed) {
      if (story.activeSpeaker === link.managed) {
        const previous = story.speakers?.some(speaker => speaker.id === link.previous) ? link.previous : null;
        await manager.setActiveSpeaker(previous);
        this.host.render();
      }
      await this.host.save({});
    }
  }
}
