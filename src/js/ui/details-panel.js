import * as L from "leaflet";

L.Control.DetailsPanel = L.Control.extend({
    options: {
        position: 'bottomright',
        title: 'Details',
    },

    onAdd: function () {
        this._container = L.DomUtil.create('div', 'leaflet-details-panel');

        this._header = L.DomUtil.create('div', 'details-panel-header', this._container);

        this._flagContainer = L.DomUtil.create('div', 'details-panel-flag', this._header);

        this._title = L.DomUtil.create('div', 'details-panel-title', this._header);
        this._title.innerHTML = `<h4>${this.options.title}</h4>`;

        this._toggleButton = L.DomUtil.create('button', 'details-panel-toggle', this._header);
        this._toggleButton.innerHTML = '➖';

        this._content = L.DomUtil.create('div', 'details-panel-content', this._container);
        this._content.innerHTML = 'Select a series or site to view details.';

        this._footer = L.DomUtil.create('div', 'details-panel-footer', this._container);

        L.DomEvent.on(this._toggleButton, 'click', this._toggleVisibility, this);

        L.DomEvent.disableClickPropagation(this._container);
        L.DomEvent.disableScrollPropagation(this._container);

        setupGroupToggles(this._content);

        return this._container;
    },

    _toggleVisibility: function (e) {
        L.DomEvent.stopPropagation(e);

        const isCollapsed = L.DomUtil.hasClass(this._container, 'collapsed');

        if (isCollapsed) {
            L.DomUtil.removeClass(this._container, 'collapsed');
            this._toggleButton.innerHTML = '➖';
        } else {
            L.DomUtil.addClass(this._container, 'collapsed');
            this._toggleButton.innerHTML = '➕';
        }
    },

    update: function ({ title = this.options.title, content = '', footer = '', flagHtml = '' }) {
        this._flagContainer.innerHTML = flagHtml;
        this._flagContainer.style.display = flagHtml ? 'flex' : 'none';
        this._title.innerHTML = `<h4>${title}</h4>`;
        this._content.innerHTML = content;
        this._footer.innerHTML = `${footer}<div class="app-version"><a href="https://github.com/ingress-shards/ingress-shards.github.io/releases" target="ism-releases">v${__APP_VERSION__}</a></div>`;
    },

    clear: function () {
        this.update({
            title: 'Details',
            content: 'Select a series or site to view details.',
        });
    }
});

export const detailsPanelControl = function (options) {
    return new L.Control.DetailsPanel(options);
};

function setupGroupToggles(containerElement) {
    containerElement.addEventListener('click', (e) => {
        const header = e.target.closest('.group-toggle');

        if (header) {
            e.preventDefault();
            const list = header.nextElementSibling;

            if (list && list.classList.contains('group-list')) {
                list.classList.toggle('collapsed-group');
                header.classList.toggle('open');
            }
        }
    });
}